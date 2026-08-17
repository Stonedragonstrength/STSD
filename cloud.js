/* ============ Stone Dragon — Supabase cloud sync ============
 *
 * Additive: localStorage stays the source of truth on each device.
 * Coach edits → debounced push of that athlete row.
 * Athlete logs progress → debounced push of progress row.
 * Athlete signs in cross-device → email+password auth via Supabase.
 * Coach opens an athlete → pulls latest progress on demand.
 *
 * All failures degrade silently (warn-and-continue). Offline still works.
 */
(function () {
  "use strict";

  const cfg = window.STONE_DRAGON_CONFIG;
  if (!cfg?.SUPABASE_URL || !cfg?.SUPABASE_ANON_KEY) {
    console.warn("[Cloud] No config; running in local-only mode.");
    window.Cloud = { enabled: false };
    return;
  }
  if (!window.supabase) {
    console.error("[Cloud] Supabase JS not loaded.");
    window.Cloud = { enabled: false };
    return;
  }
  const sb = window.supabase.createClient(cfg.SUPABASE_URL, cfg.SUPABASE_ANON_KEY, {
    auth: { persistSession: true },
  });

  // -------- Auth --------
  async function signUp(email, password) {
    const { data, error } = await sb.auth.signUp({ email, password });
    if (error) throw new Error(error.message);
    // Email confirmation is still enabled in Supabase dashboard
    if (data.user && !data.session) {
      throw new Error("EMAIL_CONFIRMATION_REQUIRED");
    }
    if (!data.user) throw new Error("Sign-up failed. Try again or sign in if you already have an account.");
    return data.user;
  }
  async function signIn(email, password) {
    const { data, error } = await sb.auth.signInWithPassword({ email, password });
    if (error) throw new Error(error.message);
    return data.user;
  }
  async function signOut() {
    // scope "local" is NOT the default — supabase-js signOut() defaults to
    // "global", which revokes every session this account has on the server.
    // That is what kept killing the Android widget's own sign-in: any routine
    // logout here (logout button, "no account found" bounce, remember-me off)
    // deleted the widget's session out from under it. Signing out everywhere
    // is a deliberate act and has its own button below.
    try { await sb.auth.signOut({ scope: "local" }); } catch (e) { console.warn("[Cloud] signOut", e); }
  }
  // Kills every session for this account, not just this browser's. Pairs with
  // clearing the athlete's push subscriptions, so an old phone goes fully dark.
  async function signOutEverywhere() {
    try {
      const { error } = await sb.auth.signOut({ scope: "global" });
      if (error) { console.warn("[Cloud] signOutEverywhere", error.message); return false; }
      return true;
    } catch (e) { console.warn("[Cloud] signOutEverywhere", e); return false; }
  }
  async function resetPassword(email) {
    const { error } = await sb.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin + window.location.pathname,
    });
    if (error) throw new Error(error.message);
  }
  async function updatePassword(newPassword) {
    const { error } = await sb.auth.updateUser({ password: newPassword });
    if (error) throw new Error(error.message);
  }
  async function getSession() {
    const { data } = await sb.auth.getSession();
    return data?.session || null;
  }
  function onAuthStateChange(cb) {
    return sb.auth.onAuthStateChange(cb);
  }

  // -------- Row <-> in-memory shape conversion --------
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
      syncedAt: r.synced_at,
      _rev: Number(r.rev) || 0,
    };
  }

  // -------- Coach methods --------
  async function upsertCoach(coachId, name, email, authUserId) {
    if (!coachId) return false;
    try {
      const row = { id: coachId, display_name: name || "", pin_hash: "" };
      if (email) row.email = email;
      if (authUserId) row.auth_user_id = authUserId;
      const { error } = await sb.from("coaches").upsert(row);
      if (error) console.warn("[Cloud] upsertCoach error", error.message);
      return !error;
    } catch (e) { console.warn("[Cloud] upsertCoach", e); return false; }
  }

  async function getCoachByAuthUserId(userId) {
    if (!userId) return null;
    try {
      const { data: coach, error } = await sb.from("coaches")
        .select("*")
        .eq("auth_user_id", userId)
        .maybeSingle();
      if (error || !coach) return null;
      const { data: athletes } = await sb.from("athletes")
        .select("*")
        .eq("coach_id", coach.id);
      // The roster is progress-driven UI — completion %, avatars, mood chips
      // and quiet flags all read importedProgress — and the athletes rows
      // above carry none of it. One bulk fetch serves every card (66 kB
      // across 22 athletes, measured in production 2026-08-13). Fail-silent
      // like everything else here: an empty map means the caller keeps
      // whatever local copies it already holds.
      const progressById = {};
      try {
        const ids = (athletes || []).map((a) => a.id);
        if (ids.length) {
          const { data: rows } = await sb.from("progress").select("*").in("athlete_id", ids);
          (rows || []).forEach((r) => { progressById[r.athlete_id] = rowToProgress(r); });
        }
      } catch (e) { console.warn("[Cloud] roster progress fetch", e); }
      return { coach, athletes: (athletes || []).map(rowToAthlete), progressById };
    } catch (e) { console.warn("[Cloud] getCoachByAuthUserId", e); return null; }
  }

  // Coach's reusable program/workout template library — shared across every
  // device the coach signs into, not just the one that created it.
  async function updateCoachTemplates(coachId, programTemplates, workoutTemplates) {
    if (!coachId) return false;
    try {
      // .select() so an update RLS filtered to zero rows (stale session, wrong
      // auth) reads as the failure it is. Without it `error` is null, the
      // caller clears its dirty flag, and the edit is recorded as synced while
      // the cloud never changed — the other devices then look "stale" forever.
      const { data, error } = await sb.from("coaches").update({
        program_templates: programTemplates || [],
        workout_templates: workoutTemplates || [],
      }).eq("id", coachId).select("id");
      if (error) console.warn("[Cloud] updateCoachTemplates error", error.message);
      return !error && Array.isArray(data) && data.length > 0;
    } catch (e) { console.warn("[Cloud] updateCoachTemplates", e); return false; }
  }

  // Coach's own pixel avatar. Safe on `coaches` (targeted column updates only,
  // never a whole-row upsert), unlike the athlete's, which lives on progress.
  async function updateCoachAvatar(coachId, avatarId) {
    if (!coachId) return false;
    try {
      const { error } = await sb.from("coaches").update({ avatar_id: avatarId || null }).eq("id", coachId);
      if (error) console.warn("[Cloud] updateCoachAvatar error", error.message);
      return !error;
    } catch (e) { console.warn("[Cloud] updateCoachAvatar", e); return false; }
  }

  // Coach's exercise-library customizations (custom exercises, hidden list,
  // category order) — one jsonb blob so they follow the coach across devices.
  async function updateCoachLibraryPrefs(coachId, prefs) {
    if (!coachId) return false;
    try {
      // Same zero-rows-is-failure guard as updateCoachTemplates: this push
      // also answers to a dirty flag, so a silent no-op must not clear it.
      const { data, error } = await sb.from("coaches").update({
        library_prefs: prefs || {},
      }).eq("id", coachId).select("id");
      if (error) console.warn("[Cloud] updateCoachLibraryPrefs error", error.message);
      return !error && Array.isArray(data) && data.length > 0;
    } catch (e) { console.warn("[Cloud] updateCoachLibraryPrefs", e); return false; }
  }

  // -------- Anatomy edits (coach curates the Anatomy/Science page) --------
  // Coach writes their own row; athletes read via SECURITY DEFINER RPC.
  async function updateCoachAnatomyEdits(coachId, edits) {
    if (!coachId) return false;
    try {
      // Same zero-rows-is-failure guard as updateCoachTemplates.
      const { data, error } = await sb.from("coaches").update({ anatomy_edits: edits || {} }).eq("id", coachId).select("id");
      if (!error && !(Array.isArray(data) && data.length)) return false;
      if (error) console.warn("[Cloud] updateCoachAnatomyEdits error", error.message);
      return !error;
    } catch (e) { console.warn("[Cloud] updateCoachAnatomyEdits", e); return false; }
  }
  async function getAnatomyEditsForAthlete() {
    try {
      const { data, error } = await sb.rpc("anatomy_edits_for_athlete");
      if (error) { console.warn("[Cloud] getAnatomyEditsForAthlete", error.message); return null; }
      return data && typeof data === "object" ? data : {};
    } catch (e) { console.warn(e); return null; }
  }

  // -------- Scheduling: availability, bookings, Google Calendar --------
  async function updateCoachAvailability(coachId, availability) {
    if (!coachId) return false;
    try {
      const { error } = await sb.from("coaches").update({ availability: availability || {} }).eq("id", coachId);
      if (error) console.warn("[Cloud] updateCoachAvailability error", error.message);
      return !error;
    } catch (e) { console.warn("[Cloud] updateCoachAvailability", e); return false; }
  }
  async function getCoachAvailability(coachId) {
    if (!coachId) return null;
    try {
      const { data, error } = await sb.from("coaches").select("availability").eq("id", coachId).maybeSingle();
      if (error || !data) return null;
      return data.availability && typeof data.availability === "object" ? data.availability : {};
    } catch (e) { console.warn("[Cloud] getCoachAvailability", e); return null; }
  }
  // Athlete reads their coach's availability through a definer RPC — the
  // coaches table's RLS won't let them read the row itself.
  async function getAvailabilityForAthlete() {
    try {
      const { data, error } = await sb.rpc("availability_for_athlete");
      if (error) { console.warn("[Cloud] getAvailabilityForAthlete", error.message); return null; }
      return data && typeof data === "object" ? data : {};
    } catch (e) { console.warn(e); return null; }
  }
  // Start/end pairs only, for the window being offered. This is the ONLY way an
  // athlete learns another athlete's time is taken — never who took it.
  async function getBookedWindow(fromISO, toISO) {
    try {
      const { data, error } = await sb.rpc("booked_starts_for_athlete", { from_at: fromISO, to_at: toISO });
      if (error) { console.warn("[Cloud] getBookedWindow", error.message); return null; }
      return (data || []).map((r) => ({ start: r.start_at, end: r.end_at }));
    } catch (e) { console.warn(e); return null; }
  }
  // Returns { ok } or { ok:false, taken:true } when someone else got there
  // first — 23505 from the partial unique index is the race being caught, and
  // it is the authority on who won, not any check we do beforehand.
  async function createBooking(row) {
    try {
      const { error } = await sb.from("bookings").insert(row);
      if (error) {
        const taken = error.code === "23505";
        if (!taken) console.warn("[Cloud] createBooking", error.message);
        return { ok: false, taken, message: error.message };
      }
      return { ok: true };
    } catch (e) { console.warn("[Cloud] createBooking", e); return { ok: false, taken: false }; }
  }
  // A whole series at once (the coach booking a weekly regular). Sent as one
  // statement first because that is one round trip instead of fifty-two; but a
  // single duplicate start time fails the entire statement, so a 23505 drops to
  // a row at a time to find out exactly WHICH dates were already taken. The
  // coach gets the rest booked and a list of what was skipped, rather than an
  // all-or-nothing failure they have to unpick by hand.
  async function createBookings(rows) {
    const list = Array.isArray(rows) ? rows : [];
    if (!list.length) return { created: [], taken: [] };
    try {
      const { error } = await sb.from("bookings").insert(list);
      if (!error) return { created: list.map((r) => r.id), taken: [] };
      if (error.code !== "23505") {
        console.warn("[Cloud] createBookings", error.message);
        return { created: [], taken: [], message: error.message };
      }
    } catch (e) {
      console.warn("[Cloud] createBookings", e);
      return { created: [], taken: [], message: String(e) };
    }
    const created = [], taken = [];
    for (const r of list) {
      try {
        const { error } = await sb.from("bookings").insert(r);
        if (!error) created.push(r.id);
        else if (error.code === "23505") taken.push(r.start_at);
        else console.warn("[Cloud] createBookings row", error.message);
      } catch (e) { console.warn("[Cloud] createBookings row", e); }
    }
    return { created, taken };
  }
  // "This one and every one after it." Everything already in the past stays on
  // the books — those sessions happened, and the session bank has charged for
  // them. Returns the ids it cancelled so their calendar events can follow.
  async function cancelBookingSeries(seriesId, fromISO) {
    if (!seriesId) return [];
    try {
      const { data, error } = await sb.from("bookings")
        .update({ status: "cancelled", cancelled_at: new Date().toISOString() })
        .eq("series_id", seriesId).eq("status", "booked")
        .gte("start_at", fromISO || new Date().toISOString())
        .select("id");
      if (error) { console.warn("[Cloud] cancelBookingSeries", error.message); return []; }
      return (data || []).map((r) => r.id);
    } catch (e) { console.warn("[Cloud] cancelBookingSeries", e); return []; }
  }
  // Move one booking to a new time. Same 23505 contract as createBooking: the
  // partial unique index is the authority on whether the target slot was free,
  // so a clash comes back as { taken:true } rather than being guessed at first.
  // Deliberately one booking — moving a whole weekly series is a different act,
  // and doing it by accident from a day sheet would be a bad afternoon.
  async function updateBookingTime(id, startISO, endISO) {
    try {
      const { error } = await sb.from("bookings")
        .update({ start_at: startISO, end_at: endISO })
        .eq("id", id).eq("status", "booked");
      if (error) {
        const taken = error.code === "23505";
        if (!taken) console.warn("[Cloud] updateBookingTime", error.message);
        return { ok: false, taken, message: error.message };
      }
      return { ok: true };
    } catch (e) { console.warn("[Cloud] updateBookingTime", e); return { ok: false, taken: false }; }
  }
  async function cancelBooking(id) {
    try {
      const { error } = await sb.from("bookings")
        .update({ status: "cancelled", cancelled_at: new Date().toISOString() }).eq("id", id);
      if (error) console.warn("[Cloud] cancelBooking", error.message);
      return !error;
    } catch (e) { console.warn("[Cloud] cancelBooking", e); return false; }
  }
  // Whole rows. RLS narrows this to the caller's own bookings for an athlete
  // and to every athlete's for the coach, so both sides use the same call.
  // `includeCancelled` is for one caller: the calendar merge needs to know which
  // slots the APP owns, and a cancelled booking still owns its slot. Without it
  // the dead Setmore mirror starts speaking for a session the coach cancelled,
  // and the auto-redeem walker charges for it. Everything else wants booked only.
  // PostgREST caps a select at the project's max-rows — 1000 by default — and
  // says nothing when it does. It just hands back a short list.
  //
  // Ordered ascending, the rows that go missing are the FURTHEST OUT, which is
  // the hardest kind of wrong to notice: "12 left, through October" quietly
  // becomes "9 left, through September" and still reads like an answer. Every
  // money surface that counts bookings would drift down together, plausibly,
  // with nothing on screen admitting it. So this pages instead of trusting one
  // request.
  //
  // Paged against an exact COUNT rather than "stop on a short page", because a
  // short page cannot be told apart from the server's own cap being lower than
  // the page size — the exact failure being defended against. The count rides
  // along on the first request; there is no extra round-trip for it, and no
  // second request at all until the window really does hold more than one page.
  // Matched to PostgREST's own default cap, so the ordinary case is exactly one
  // request and nothing about today's cost changes. A SMALLER page would be
  // safe but wasteful: at 500, a coach already holding 678 rows would pay two
  // round-trips on every schedule refresh forever, to guard a limit they have
  // not reached. Correctness here comes from the offset below, not from the
  // page size — a server capping lower than this is handled either way.
  const BOOKINGS_PAGE = 1000;
  //
  // `athleteId` narrows it to one athlete, and the ATHLETE SIDE MUST PASS IT.
  // RLS alone does not mean "mine": the policies are OR'd, so an account that
  // is both a coach and an athlete — which is any coach who keeps their own
  // training in the app — matches "coach manages own bookings" as well as
  // "athlete reads own bookings" and gets the WHOLE ROSTER back. That is not a
  // leak to anyone else, but on their own athlete page it drew hundreds of
  // upcoming sessions belonging to other people. Scoping belongs in the query
  // that knows whose page it is, not in a policy that cannot tell.
  async function getBookings(fromISO, toISO, includeCancelled, athleteId) {
    try {
      const out = [];
      let total = Infinity;
      while (out.length < total) {
        // The offset is what we ALREADY HAVE, never a multiple of the page
        // size. A server whose own cap is smaller than the page hands back a
        // short page, and stepping by the page size would then skip exactly the
        // rows it withheld — silently, and only on the busiest coaches.
        const from = out.length;
        let q = sb.from("bookings")
          .select("*", { count: "exact" })
          .order("start_at", { ascending: true })
          .range(from, from + BOOKINGS_PAGE - 1);
        if (!includeCancelled) q = q.eq("status", "booked");
        if (athleteId) q = q.eq("athlete_id", athleteId);
        if (fromISO) q = q.gte("start_at", fromISO);
        if (toISO) q = q.lt("start_at", toISO);
        const { data, error, count } = await q;
        if (error) { console.warn("[Cloud] getBookings", error.message); return null; }
        if (typeof count === "number") total = count;
        const rows = data || [];
        out.push(...rows);
        // An empty page means the server has nothing more to give, whatever the
        // count claimed. Without this, a count that disagrees with the rows —
        // a delete landing mid-page, say — would spin forever.
        if (!rows.length) break;
      }
      return out;
    } catch (e) { console.warn(e); return null; }
  }

  // ---- Changing a booking the athlete already holds ----
  // Two paths, and which one applies is the database's call rather than the
  // UI's: outside the coach's notice window the athlete acts, inside it they
  // ask. The client mirrors the same rule so the buttons make sense, but every
  // one of these can come back refusing, and the refusal is the truth.
  //
  // Every failure arrives as a `reason` string rather than a bare false:
  //   taken      someone booked that slot first (23505 — the index decides)
  //   too_late   inside the notice window; use requestBookingChange instead
  //   just_do_it OUTSIDE it; no request needed, move or cancel directly
  //   not_open   that time isn't in the coach's published hours
  //   pending    this booking already has a request waiting on the coach

  // Moving is one RPC and not a cancel followed by an insert, because from a
  // browser those two are not atomic: the old slot would be released first, and
  // losing the race for the new one would leave the athlete holding nothing.
  async function moveMyBooking(bookingId, newId, startISO, endISO) {
    try {
      const { data, error } = await sb.rpc("athlete_move_booking", {
        p_booking_id: bookingId, p_new_id: newId, p_new_start: startISO, p_new_end: endISO,
      });
      if (error) { console.warn("[Cloud] moveMyBooking", error.message); return { ok: false, reason: "error" }; }
      return data || { ok: false, reason: "error" };
    } catch (e) { console.warn("[Cloud] moveMyBooking", e); return { ok: false, reason: "error" }; }
  }
  // `kind` is "cancel" or "move"; the times are ignored for a cancel.
  async function requestBookingChange(id, bookingId, kind, startISO, endISO, note) {
    try {
      const { data, error } = await sb.rpc("request_booking_change", {
        p_id: id, p_booking_id: bookingId, p_kind: kind,
        p_new_start: startISO || null, p_new_end: endISO || null, p_note: note || null,
      });
      if (error) { console.warn("[Cloud] requestBookingChange", error.message); return { ok: false, reason: "error" }; }
      return data || { ok: false, reason: "error" };
    } catch (e) { console.warn("[Cloud] requestBookingChange", e); return { ok: false, reason: "error" }; }
  }
  async function withdrawBookingRequest(id) {
    try {
      const { data, error } = await sb.rpc("withdraw_booking_request", { p_id: id });
      if (error) { console.warn("[Cloud] withdrawBookingRequest", error.message); return { ok: false }; }
      return data || { ok: false };
    } catch (e) { console.warn("[Cloud] withdrawBookingRequest", e); return { ok: false }; }
  }
  // The coach's answer. Approving performs the change and returns what the
  // calendar needs to follow — `googleEventId` on a cancel, the new `id` on a
  // move. It can still come back { ok:false, reason:"taken" }: a pending
  // request never held the slot, deliberately, so somebody may have taken it
  // while the coach was deciding. The request stays pending in that case.
  async function resolveBookingRequest(id, approve, newId) {
    try {
      const { data, error } = await sb.rpc("resolve_booking_request", {
        p_id: id, p_approve: !!approve, p_new_id: newId || null,
      });
      if (error) { console.warn("[Cloud] resolveBookingRequest", error.message); return { ok: false, reason: "error" }; }
      return data || { ok: false, reason: "error" };
    } catch (e) { console.warn("[Cloud] resolveBookingRequest", e); return { ok: false, reason: "error" }; }
  }
  // RLS scopes this the same way getBookings does — and carries the same catch,
  // so the athlete side passes `athleteId` rather than trusting it. The policies
  // are OR'd, so an account that is both a coach and an athlete matches "coach
  // manages own booking requests" too and sees the whole roster's. The coach
  // side passes nothing and still gets everyone's, which is the point of it.
  async function getBookingRequests(pendingOnly, athleteId) {
    try {
      let q = sb.from("booking_requests").select("*").order("created_at", { ascending: false });
      if (pendingOnly !== false) q = q.eq("status", "pending");
      if (athleteId) q = q.eq("athlete_id", athleteId);
      const { data, error } = await q;
      if (error) { console.warn("[Cloud] getBookingRequests", error.message); return null; }
      return data || [];
    } catch (e) { console.warn("[Cloud] getBookingRequests", e); return null; }
  }
  // Puts a filed request on the coach's phone. Only an id crosses the wire —
  // the Edge Function writes the wording itself from the rows, so an athlete
  // can never choose the text that appears on the coach's lock screen.
  async function notifyCoachOfRequest(requestId) {
    try {
      const { data, error } = await sb.functions.invoke("notify-coach", { body: { requestId } });
      if (error) { console.warn("[Cloud] notifyCoachOfRequest", error.message || error); return null; }
      return data;
    } catch (e) { console.warn("[Cloud] notifyCoachOfRequest", e); return null; }
  }

  // ---- Google Calendar ----
  // Every call goes through the Edge Function: the refresh token lives in a
  // table no browser role can read, and the client secret is a function secret.
  async function googleCall(action, payload) {
    try {
      const { data, error } = await sb.functions.invoke("google-calendar", {
        body: { action, ...(payload || {}) },
      });
      if (error) {
        // A non-2xx response still carries the function's JSON body, but only
        // on error.context. Without reading it, every failure reaches the UI
        // as a bare null and they all look identical.
        try {
          const body = await error.context?.json?.();
          if (body && typeof body === "object") return body;
        } catch (e) { /* not JSON — fall through to the warning */ }
        console.warn("[Cloud] googleCall", action, error.message);
        return null;
      }
      return data || null;
    } catch (e) { console.warn("[Cloud] googleCall", action, e); return null; }
  }
  // What the browser may know: connected or not, and which account. Not the token.
  async function googleStatus() {
    try {
      const { data, error } = await sb.rpc("google_calendar_status");
      if (error) { console.warn("[Cloud] googleStatus", error.message); return null; }
      const row = (data || [])[0];
      return row ? { connected: true, email: row.account_email || "", calendarId: row.calendar_id || "primary", lastError: row.last_error || "" }
                 : { connected: false };
    } catch (e) { console.warn(e); return null; }
  }

  // -------- Open slots (coach broadcasts appointment openings) --------
  async function updateCoachOpenSlots(coachId, openSlots) {
    if (!coachId) return false;
    try {
      const { error } = await sb.from("coaches").update({ open_slots: openSlots || [] }).eq("id", coachId);
      if (error) console.warn("[Cloud] updateCoachOpenSlots error", error.message);
      return !error;
    } catch (e) { console.warn("[Cloud] updateCoachOpenSlots", e); return false; }
  }

  // Coach re-reads their own open_slots to pick up athlete claims.
  async function getCoachOpenSlots(coachId) {
    if (!coachId) return null;
    try {
      const { data, error } = await sb.from("coaches").select("open_slots").eq("id", coachId).maybeSingle();
      if (error || !data) return null;
      return Array.isArray(data.open_slots) ? data.open_slots : [];
    } catch (e) { console.warn("[Cloud] getCoachOpenSlots", e); return null; }
  }

  // Athlete reads their coach's open slots (SECURITY DEFINER RPC — the athletes
  // table RLS won't let them read the coach row directly).
  async function getOpenSlotsForAthlete() {
    try {
      const { data, error } = await sb.rpc("open_slots_for_athlete");
      if (error) { console.warn("[Cloud] getOpenSlotsForAthlete", error.message); return null; }
      return Array.isArray(data) ? data : [];
    } catch (e) { console.warn(e); return null; }
  }

  // Atomic first-come claim. Returns { ok, reason?, slot?, claimedByName? }.
  async function claimOpenSlot(slotId) {
    try {
      const { data, error } = await sb.rpc("claim_open_slot", { slot_id: slotId });
      if (error) { console.warn("[Cloud] claimOpenSlot", error.message); return { ok: false, reason: "error" }; }
      return data || { ok: false, reason: "unknown" };
    } catch (e) { console.warn(e); return { ok: false, reason: "error" }; }
  }

  // -------- Athlete methods --------
  // Guarded whole-row write. When this device knows the row's rev, the update
  // only lands if the cloud is still at that rev — a write from a copy the
  // cloud has moved past is DETECTED for the first time. On detection: adopt
  // the head rev and retry ONCE with this device's content (latest intent
  // wins, but knowingly), and report the collision through onConflict so the
  // UI can say so. A device that has never learned a rev (first rollout, new
  // athlete) takes the old unconditional upsert and learns the rev from it.
  let _conflictCb = null;
  function onConflict(cb) { _conflictCb = typeof cb === "function" ? cb : null; }
  async function upsertAthlete(athlete, coachId) {
    const row = athleteToRow(athlete, coachId);
    if (!row) return false;
    try {
      const base = Number(athlete._rev) || 0;
      if (base > 0) {
        const { data, error } = await sb.from("athletes")
          .update(row).eq("id", row.id).eq("rev", base).select("rev");
        if (error) { console.warn("[Cloud] upsertAthlete error", error.message); return false; }
        if (data && data.length) { athlete._rev = data[0].rev; return true; }
        // The cloud moved past this device's copy. Rebase and retry once.
        const { data: head, error: e2 } = await sb.from("athletes")
          .select("rev").eq("id", row.id).maybeSingle();
        if (e2 || !head) { console.warn("[Cloud] upsertAthlete rebase read failed", e2?.message); return false; }
        const { data: d2, error: e3 } = await sb.from("athletes")
          .update(row).eq("id", row.id).eq("rev", head.rev).select("rev");
        if (e3 || !d2 || !d2.length) { console.warn("[Cloud] upsertAthlete rebase write lost a second race"); return false; }
        athlete._rev = d2[0].rev;
        try { _conflictCb && _conflictCb(athlete.id, athlete.name || ""); } catch (e) {}
        return true;
      }
      const { data, error } = await sb.from("athletes").upsert(row).select("rev");
      if (error) { console.warn("[Cloud] upsertAthlete error", error.message); return false; }
      if (data && data[0]) athlete._rev = Number(data[0].rev) || 0;
      return true;
    } catch (e) { console.warn("[Cloud] upsertAthlete", e); return false; }
  }

  async function deleteAthlete(athleteId) {
    if (!athleteId) return false;
    try {
      const { error } = await sb.from("athletes").delete().eq("id", athleteId);
      if (error) console.warn("[Cloud] deleteAthlete error", error.message);
      return !error;
    } catch (e) { console.warn("[Cloud] deleteAthlete", e); return false; }
  }

  // RLS keeps the athletes table private; this security-definer RPC is the
  // one anon-reachable lookup, gated on knowing the exact invite code.
  async function getAthleteByInviteCode(code) {
    try {
      const { data, error } = await sb.rpc("athlete_by_invite_code", { code });
      if (error) { console.warn("[Cloud] getAthleteByInviteCode", error.message); return null; }
      return rowToAthlete(Array.isArray(data) ? data[0] : data);
    } catch (e) { console.warn(e); return null; }
  }

  // Anon progress pull for first-device invite login (before the athlete has
  // an auth session, so the RLS-protected progress table isn't readable yet).
  async function getProgressByInviteCode(code) {
    try {
      const { data, error } = await sb.rpc("progress_by_invite_code", { code });
      if (error) { console.warn("[Cloud] getProgressByInviteCode", error.message); return null; }
      const row = Array.isArray(data) ? data[0] : data;
      return row ? rowToProgress(row) : null;
    } catch (e) { console.warn(e); return null; }
  }

  async function getAthleteById(id) {
    try {
      const { data, error } = await sb.from("athletes").select("*").eq("id", id).maybeSingle();
      if (error) return null;
      return rowToAthlete(data);
    } catch (e) { return null; }
  }

  // Athlete-side write: PRs are a shared list, so the athlete can push their
  // own edits back to the same athletes row the coach reads/writes.
  // Returns the row's new rev (the update bumps it via trigger) so the caller
  // can recognise the realtime echo of this write as its own; true if the
  // write landed but no rev came back, false on failure.
  async function updateAthleteCoachPRs(athleteId, coachPRs) {
    if (!athleteId) return false;
    try {
      const { data, error } = await sb.from("athletes")
        .update({ coach_prs: coachPRs || [] }).eq("id", athleteId).select("rev");
      if (error) { console.warn("[Cloud] updateAthleteCoachPRs error", error.message); return false; }
      return Number(data?.[0]?.rev) || true;
    } catch (e) { console.warn("[Cloud] updateAthleteCoachPRs", e); return false; }
  }

  // Coach-side "reset access": clears the athlete's auth link so their row is
  // unclaimed again and can be claimed fresh with a newly regenerated invite
  // code. Pairs with the hardened claim RPC (which refuses to re-link an
  // already-claimed account). The coach owns the row, so RLS permits this.
  async function unlinkAthleteAuth(athleteId) {
    if (!athleteId) return false;
    try {
      const { error } = await sb.from("athletes").update({ auth_user_id: null }).eq("id", athleteId);
      if (error) console.warn("[Cloud] unlinkAthleteAuth error", error.message);
      return !error;
    } catch (e) { console.warn("[Cloud] unlinkAthleteAuth", e); return false; }
  }

  // Athlete-side write: toggle their own open-slot alert preference.
  async function updateAthleteHideOpenSlots(athleteId, hide) {
    if (!athleteId) return false;
    try {
      const { error } = await sb.from("athletes").update({ hide_open_slots: !!hide }).eq("id", athleteId);
      if (error) console.warn("[Cloud] updateAthleteHideOpenSlots error", error.message);
      return !error;
    } catch (e) { console.warn("[Cloud] updateAthleteHideOpenSlots", e); return false; }
  }

  // Coach-side write: may this athlete book their own sessions? A single-column
  // update rather than a whole-athlete upsert, so flipping a switch can't race
  // a program edit and write back a stale `weeks`.
  async function updateAthleteCanBook(athleteId, allowed) {
    if (!athleteId) return false;
    try {
      const { error } = await sb.from("athletes").update({ can_book: !!allowed }).eq("id", athleteId);
      if (error) console.warn("[Cloud] updateAthleteCanBook error", error.message);
      return !error;
    } catch (e) { console.warn("[Cloud] updateAthleteCanBook", e); return false; }
  }

  // Athlete self-edits their own vitals (name / age / height / weight / goals)
  // on the shared athletes row so the coach sees the same information.
  async function updateAthleteProfileFields(athleteId, fields) {
    if (!athleteId || !fields) return false;
    try {
      const row = { updated_at: new Date().toISOString() };
      if ("name" in fields) row.display_name = fields.name || "";
      if ("age" in fields) row.age = fields.age || null;
      if ("birthday" in fields) row.birthday = fields.birthday || null;
      if ("heightIn" in fields) row.height_in = fields.heightIn || null;
      if ("weightLb" in fields) row.weight_lb = fields.weightLb || null;
      if ("units" in fields) row.units = fields.units === "kg" ? "kg" : "lb";
      if ("goals" in fields) row.goals = fields.goals || null;
      if ("trainingLevel" in fields) row.training_level = fields.trainingLevel || null;
      const { error } = await sb.from("athletes").update(row).eq("id", athleteId);
      if (error) console.warn("[Cloud] updateAthleteProfileFields error", error.message);
      return !error;
    } catch (e) { console.warn("[Cloud] updateAthleteProfileFields", e); return false; }
  }

  async function getAthleteByAuthUserId(userId) {
    if (!userId) return null;
    try {
      const { data: athlete, error } = await sb.from("athletes")
        .select("*")
        .eq("auth_user_id", userId)
        .maybeSingle();
      if (error || !athlete) return null;
      const { data: progress } = await sb.from("progress")
        .select("*")
        .eq("athlete_id", athlete.id)
        .maybeSingle();
      return { athlete: rowToAthlete(athlete), progress: progress ? rowToProgress(progress) : null };
    } catch (e) { console.warn("[Cloud] getAthleteByAuthUserId", e); return null; }
  }

  // The freshly signed-up athlete doesn't own their row yet, so the claim
  // goes through a security-definer RPC keyed on the invite code. The profile
  // upsert must come after — owning the row is what RLS checks.
  async function linkAthleteToAuth(athleteId, authUserId, email, inviteCode) {
    if (!athleteId || !authUserId || !inviteCode) return false;
    try {
      const { data: claimed, error: ce } = await sb.rpc("claim_athlete_by_invite_code", { code: inviteCode });
      if (ce || !claimed) {
        console.warn("[Cloud] linkAthleteToAuth claim failed", ce?.message || "no matching invite code");
        return false;
      }
      await sb.from("athlete_profiles").upsert({
        athlete_id: athleteId,
        display_name: "",
        pw_hash: "",
        email: email || "",
      });
      return true;
    } catch (e) { console.warn("[Cloud] linkAthleteToAuth", e); return false; }
  }

  // -------- Web push --------
  // Subscription rows are written by the signed-in athlete (RLS-scoped);
  // sends go through the send-push Edge Function with the coach's JWT.
  async function savePushSubscription(athleteId, subscription) {
    if (!athleteId || !subscription?.endpoint) return false;
    try {
      const { error } = await sb.from("push_subscriptions").upsert(
        { athlete_id: athleteId, endpoint: subscription.endpoint, subscription },
        { onConflict: "endpoint" }
      );
      if (error) { console.warn("[Cloud] savePushSubscription", error.message); return false; }
      return true;
    } catch (e) { console.warn("[Cloud] savePushSubscription", e); return false; }
  }
  // The coach's own device. Same table, same endpoint-keyed upsert, different
  // owner column — and `endpoint` is unique, so a browser signed into both
  // roles owns exactly one row and the last subscribe wins. That is why the
  // athlete_id is cleared explicitly: without it an upsert onto a row that used
  // to be an athlete's would leave both columns set and fail the one-owner
  // check the booking-changes migration added.
  async function saveCoachPushSubscription(coachId, subscription) {
    if (!coachId || !subscription?.endpoint) return false;
    try {
      const { error } = await sb.from("push_subscriptions").upsert(
        { coach_id: coachId, athlete_id: null, endpoint: subscription.endpoint, subscription },
        { onConflict: "endpoint" }
      );
      if (error) { console.warn("[Cloud] saveCoachPushSubscription", error.message); return false; }
      return true;
    } catch (e) { console.warn("[Cloud] saveCoachPushSubscription", e); return false; }
  }
  async function deletePushSubscription(endpoint) {
    if (!endpoint) return false;
    try {
      const { error } = await sb.from("push_subscriptions").delete().eq("endpoint", endpoint);
      if (error) { console.warn("[Cloud] deletePushSubscription", error.message); return false; }
      return true;
    } catch (e) { console.warn("[Cloud] deletePushSubscription", e); return false; }
  }
  // `kind` is one of "bulletin" | "message" | "formcheck". The Edge Function
  // drops athletes who muted that kind or are inside their quiet hours, so the
  // caller never has to know a recipient's preferences.
  async function sendPush(athleteIds, title, body, url, kind) {
    try {
      const { data, error } = await sb.functions.invoke("send-push", {
        body: { athleteIds, title, body, url, kind },
      });
      if (error) { console.warn("[Cloud] sendPush", error.message || error); return null; }
      return data;
    } catch (e) { console.warn("[Cloud] sendPush", e); return null; }
  }
  // Every device this athlete enabled notifications on. Used by "sign out
  // everywhere", so a lost or borrowed phone stops receiving their pushes.
  async function deleteAllPushSubscriptions(athleteId) {
    if (!athleteId) return false;
    try {
      const { error } = await sb.from("push_subscriptions").delete().eq("athlete_id", athleteId);
      if (error) { console.warn("[Cloud] deleteAllPushSubscriptions", error.message); return false; }
      return true;
    } catch (e) { console.warn("[Cloud] deleteAllPushSubscriptions", e); return false; }
  }

  // -------- Athlete preferences --------
  // Notification categories, the daily reminder, quiet hours, and the app
  // surface switches (simple mode, hidden body weight). Their own table:
  // the push Edge Functions read it on every send, and `last_reminder_on` is
  // server-written, so it can't ride along on the progress row.
  const PREF_COLS = {
    bulletins:    "notify_bulletins",
    messages:     "notify_messages",
    formChecks:   "notify_formchecks",
    sessionsOn:   "notify_sessions",
    sessionLead:  "session_lead_mins",
    reminderOn:   "reminder_on",
    reminderTime: "reminder_time",
    tz:           "tz",
    quietOn:      "quiet_on",
    quietFrom:    "quiet_from",
    quietTo:      "quiet_to",
    simple:       "simple_mode",
    hideWeight:   "hide_weight",
  };
  async function getAthletePrefs(athleteId) {
    if (!athleteId) return null;
    try {
      const { data, error } = await sb.from("athlete_prefs")
        .select("*").eq("athlete_id", athleteId).maybeSingle();
      if (error || !data) return null;
      const out = {};
      for (const [k, col] of Object.entries(PREF_COLS)) {
        if (data[col] !== null && data[col] !== undefined) out[k] = data[col];
      }
      return out;
    } catch (e) { console.warn("[Cloud] getAthletePrefs", e); return null; }
  }
  async function saveAthletePrefs(athleteId, prefs) {
    if (!athleteId || !prefs) return false;
    try {
      const row = { athlete_id: athleteId, updated_at: new Date().toISOString() };
      for (const [k, col] of Object.entries(PREF_COLS)) {
        if (prefs[k] !== undefined) row[col] = prefs[k];
      }
      const { error } = await sb.from("athlete_prefs").upsert(row, { onConflict: "athlete_id" });
      if (error) { console.warn("[Cloud] saveAthletePrefs", error.message); return false; }
      return true;
    } catch (e) { console.warn("[Cloud] saveAthletePrefs", e); return false; }
  }

  // -------- Cycle tracking (private by default) --------
  // Its own table with no coach policy at all — see the migration. The athlete
  // reads and writes their own row; a coach gets nothing here, and reaches
  // sharing athletes only through cycle_shares_for_coach(), which redacts
  // server-side to the level each athlete picked.
  async function getMyCycle(athleteId) {
    if (!athleteId) return null;
    try {
      const { data, error } = await sb.from("cycle_logs")
        .select("*").eq("athlete_id", athleteId).maybeSingle();
      if (error) { console.warn("[Cloud] getMyCycle", error.message); return null; }
      if (!data) return null;
      return {
        enabled: !!data.enabled,
        share: data.share_level || "private",
        periods: Array.isArray(data.periods) ? data.periods : [],
        notes: data.notes && typeof data.notes === "object" ? data.notes : {},
      };
    } catch (e) { console.warn("[Cloud] getMyCycle", e); return null; }
  }
  async function saveMyCycle(athleteId, cycle) {
    if (!athleteId || !cycle) return false;
    try {
      const { error } = await sb.from("cycle_logs").upsert({
        athlete_id: athleteId,
        enabled: !!cycle.enabled,
        share_level: cycle.share || "private",
        periods: cycle.periods || [],
        notes: cycle.notes || {},
        updated_at: new Date().toISOString(),
      }, { onConflict: "athlete_id" });
      if (error) { console.warn("[Cloud] saveMyCycle", error.message); return false; }
      return true;
    } catch (e) { console.warn("[Cloud] saveMyCycle", e); return false; }
  }
  // Athlete-initiated erase: "delete everything I've tracked". Drops the row,
  // not just its contents, so nothing lingers server-side.
  async function deleteMyCycle(athleteId) {
    if (!athleteId) return false;
    try {
      const { error } = await sb.from("cycle_logs").delete().eq("athlete_id", athleteId);
      if (error) { console.warn("[Cloud] deleteMyCycle", error.message); return false; }
      return true;
    } catch (e) { console.warn("[Cloud] deleteMyCycle", e); return false; }
  }
  // Coach side. Only athletes who opted in appear at all.
  async function getCycleShares() {
    try {
      const { data, error } = await sb.rpc("cycle_shares_for_coach");
      if (error) { console.warn("[Cloud] getCycleShares", error.message); return []; }
      return (data || []).map((r) => ({
        athleteId: r.athlete_id,
        share: r.share_level,
        periods: Array.isArray(r.periods) ? r.periods : [],
        notes: r.notes && typeof r.notes === "object" ? r.notes : {},
      }));
    } catch (e) { console.warn("[Cloud] getCycleShares", e); return []; }
  }

  // -------- Messages (two-way coach ↔ athlete thread) --------
  // One row per message in `messages`, keyed by athlete. Both sides may append
  // and read; RLS + a trigger keep each end from rewriting the other's words.
  // Every call fails soft: offline just means the thread doesn't refresh.
  async function sendMessage(athleteId, sender, body) {
    if (!athleteId || !sender || !body) return null;
    try {
      const { data, error } = await sb.from("messages")
        .insert({ athlete_id: athleteId, sender, body: String(body).slice(0, 2000) })
        .select().single();
      if (error) { console.warn("[Cloud] sendMessage", error.message); return null; }
      return data;
    } catch (e) { console.warn("[Cloud] sendMessage", e); return null; }
  }
  // One athlete's thread, oldest first — the order it reads in.
  async function getMessages(athleteId, limit = 200) {
    if (!athleteId) return [];
    try {
      const { data, error } = await sb.from("messages")
        .select("*").eq("athlete_id", athleteId)
        .order("created_at", { ascending: false }).limit(limit);
      if (error) { console.warn("[Cloud] getMessages", error.message); return []; }
      return (data || []).reverse();
    } catch (e) { console.warn("[Cloud] getMessages", e); return []; }
  }
  // Every thread the coach can see, newest first. The coach's Messages view
  // and unread badges are both built from this one call.
  async function getAllMessages(limit = 500) {
    try {
      const { data, error } = await sb.from("messages")
        .select("*").order("created_at", { ascending: false }).limit(limit);
      if (error) { console.warn("[Cloud] getAllMessages", error.message); return []; }
      return data || [];
    } catch (e) { console.warn("[Cloud] getAllMessages", e); return []; }
  }
  // Stamp the other side's messages as read. The trigger on the table means
  // this is the only column an update is allowed to touch.
  async function markMessagesRead(ids) {
    const list = (ids || []).filter(Boolean);
    if (!list.length) return false;
    try {
      const { error } = await sb.from("messages")
        .update({ read_at: new Date().toISOString() }).in("id", list);
      if (error) { console.warn("[Cloud] markMessagesRead", error.message); return false; }
      return true;
    } catch (e) { console.warn("[Cloud] markMessagesRead", e); return false; }
  }

  // Branded-food text search. Proxied through an Edge Function because the
  // USDA key is confidential and can't live in config.js — see
  // supabase/functions/food-search. Returns [] on any failure so the caller
  // can just show "no results" when offline.
  async function searchFoodsOnline(q) {
    try {
      const { data, error } = await sb.functions.invoke("food-search", { body: { q } });
      if (error) { console.warn("[Cloud] searchFoodsOnline", error.message || error); return []; }
      return Array.isArray(data?.foods) ? data.foods : [];
    } catch (e) { console.warn("[Cloud] searchFoodsOnline", e); return []; }
  }

  // -------- Form-check videos (private Storage bucket) --------
  // Layout: <athleteId>/<dayId>/<uid>.<ext>. RLS lets the owning athlete write
  // and read their own folder, and lets that athlete's coach read/delete it.
  const FORM_CHECK_BUCKET = "form-checks";
  async function uploadFormCheck(athleteId, dayId, blob, ext = "webm", contentType = "video/webm") {
    if (!athleteId || !dayId || !blob) return null;
    const path = `${athleteId}/${dayId}/${uidLike()}.${ext}`;
    try {
      const { error } = await sb.storage.from(FORM_CHECK_BUCKET).upload(path, blob, {
        contentType,
        upsert: false,
      });
      if (error) { console.warn("[Cloud] uploadFormCheck", error.message); return null; }
      return path;
    } catch (e) { console.warn("[Cloud] uploadFormCheck", e); return null; }
  }
  // Short-lived signed URL for playback (bucket is private).
  async function signedFormCheckUrl(path, expiresSec = 3600) {
    if (!path) return null;
    try {
      const { data, error } = await sb.storage.from(FORM_CHECK_BUCKET).createSignedUrl(path, expiresSec);
      if (error) { console.warn("[Cloud] signedFormCheckUrl", error.message); return null; }
      return data?.signedUrl || null;
    } catch (e) { console.warn("[Cloud] signedFormCheckUrl", e); return null; }
  }
  async function deleteFormCheck(path) {
    if (!path) return false;
    try {
      const { error } = await sb.storage.from(FORM_CHECK_BUCKET).remove([path]);
      if (error) { console.warn("[Cloud] deleteFormCheck", error.message); return false; }
      return true;
    } catch (e) { console.warn("[Cloud] deleteFormCheck", e); return false; }
  }
  function uidLike() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }

  // -------- Coach demo clips (private Storage bucket) --------
  // The coach's own footage for lifts the vendored still library has nothing
  // for. Layout: <coachId>/<uid>.<ext>. RLS lets the owning coach write, read
  // and delete their folder, and lets that coach's athletes read it — the clip
  // is shown to all of them, but the bucket stays private (a demo can have a
  // face in it), so playback goes through a signed URL like a form check.
  const EX_DEMO_BUCKET = "exercise-demos";
  async function uploadExerciseDemo(coachId, blob, ext = "webm", contentType = "video/webm") {
    if (!coachId || !blob) return null;
    const path = `${coachId}/${uidLike()}.${ext}`;
    try {
      const { error } = await sb.storage.from(EX_DEMO_BUCKET).upload(path, blob, {
        contentType,
        upsert: false,
      });
      if (error) { console.warn("[Cloud] uploadExerciseDemo", error.message); return null; }
      return path;
    } catch (e) { console.warn("[Cloud] uploadExerciseDemo", e); return null; }
  }
  async function signedExerciseDemoUrl(path, expiresSec = 3600) {
    if (!path) return null;
    try {
      const { data, error } = await sb.storage.from(EX_DEMO_BUCKET).createSignedUrl(path, expiresSec);
      if (error) { console.warn("[Cloud] signedExerciseDemoUrl", error.message); return null; }
      return data?.signedUrl || null;
    } catch (e) { console.warn("[Cloud] signedExerciseDemoUrl", e); return null; }
  }
  async function deleteExerciseDemo(path) {
    if (!path) return false;
    try {
      const { error } = await sb.storage.from(EX_DEMO_BUCKET).remove([path]);
      if (error) { console.warn("[Cloud] deleteExerciseDemo", error.message); return false; }
      return true;
    } catch (e) { console.warn("[Cloud] deleteExerciseDemo", e); return false; }
  }

  // -------- Billing (Square) --------
  // READS go straight through PostgREST: billing_subscriptions and
  // billing_payments both carry select policies for the owning athlete and
  // their coach. WRITES have no policy at all on either table, for anybody —
  // the only writer is the service-role key inside square-webhook, behind an
  // HMAC check. So there is deliberately no upsert function here to match.
  async function getBillingForCoach(coachId) {
    if (!coachId) return null;
    try {
      const [subs, pays] = await Promise.all([
        sb.from("billing_subscriptions").select("*").eq("coach_id", coachId),
        // Only what a money surface actually reads. A year of history is
        // pointless payload on every sign-in.
        sb.from("billing_payments").select("*").eq("coach_id", coachId)
          .gte("month_key", monthsAgoKey(3)),
      ]);
      if (subs.error) { console.warn("[Cloud] getBillingForCoach subs", subs.error.message); return null; }
      return { subscriptions: subs.data || [], payments: pays.error ? [] : (pays.data || []) };
    } catch (e) { console.warn("[Cloud] getBillingForCoach", e); return null; }
  }
  // The athlete's own charges. RLS answers "which are mine" — including a
  // partner's half of a shared bank — so there is no filtering to do here and
  // no athlete id to pass. Only ever charges the coach actually raised; the
  // app never shows an athlete an estimate of one.
  async function getBillingForAthlete() {
    try {
      const { data, error } = await sb.from("billing_payments")
        // `note` is deliberately NOT fetched: it is the coach's own annotation
        // ("goodwill", "comped") and belongs in his records, not read back to
        // the person being charged. RLS would allow it; taste doesn't.
        .select("id, month_key, amount_cents, status, checkout_url, sessions, paid_at")
        .gte("month_key", monthsAgoKey(3))
        .order("month_key", { ascending: false });
      if (error) { console.warn("[Cloud] getBillingForAthlete", error.message); return null; }
      return data || [];
    } catch (e) { console.warn("[Cloud] getBillingForAthlete", e); return null; }
  }
  // The athlete's own saved card, if they have one. RLS answers "which row is
  // mine", so there is no id to pass — the same arrangement as their charges.
  //
  // Four columns and no more: brand and last four so they can see WHICH card is
  // saved, `card_saved_at` as the only "is there one" signal the UI needs, and
  // the autopay switch. The Square card id is deliberately not fetched — the app
  // never needs to name it, only the Edge Function does.
  async function getCardForAthlete() {
    try {
      const { data, error } = await sb.from("billing_subscriptions")
        .select("card_brand, card_last4, card_saved_at, autopay")
        .limit(1);
      if (error) { console.warn("[Cloud] getCardForAthlete", error.message); return null; }
      // A row is optional — an athlete who has never been charged has none —
      // so "no row" is an answer (no card), not a failure.
      return (data && data[0]) || {};
    } catch (e) { console.warn("[Cloud] getCardForAthlete", e); return null; }
  }
  function monthsAgoKey(n) {
    const d = new Date();
    d.setMonth(d.getMonth() - n);
    return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
  }
  // The three things that need the Square access token, which can never reach a
  // browser. All of them return { ok } — see the function's own notes on why an
  // expected failure comes back as 200.
  async function squareBilling(action, payload) {
    try {
      const { data, error } = await sb.functions.invoke("square-billing", {
        body: { action, ...(payload || {}) },
      });
      if (error) return { ok: false, error: error.message || "call failed" };
      return data || { ok: false, error: "empty response" };
    } catch (e) { return { ok: false, error: String(e?.message || e) }; }
  }

  // -------- Progress methods --------
  // Progress goes up through merge_progress, which unions exercise_logs
  // entry-by-entry server-side under a row lock — two devices writing the same
  // athlete can no longer erase each other's logged work. Returns
  // { rev, exerciseLogs } (the server's merged truth; callers fold it back
  // into local state), a bare `true` on the legacy fallback path, or false.
  // Stays truthy-on-success so every existing boolean caller keeps working.
  async function upsertProgress(athleteId, progress) {
    if (!athleteId) return false;
    try {
      const payload = progressToRow(progress, athleteId);
      delete payload.athlete_id;
      const { data, error } = await sb.rpc("merge_progress", {
        p_athlete_id: athleteId, p_payload: payload,
      });
      if (!error && data) return { rev: Number(data.rev) || 0, exerciseLogs: data.exercise_logs || null };
      console.warn("[Cloud] merge_progress failed, falling back to plain upsert", error?.message);
      const { error: e2 } = await sb.from("progress").upsert(progressToRow(progress, athleteId));
      if (e2) { console.warn("[Cloud] upsertProgress error", e2.message); return false; }
      return true;
    } catch (e) { console.warn("[Cloud] upsertProgress", e); return false; }
  }

  // -------- Realtime (sync stage 3) --------
  // One set of channels per app session. subscribeSync replaces any prior set,
  // so re-targeting (opening a different athlete, entering a live session) is
  // just calling it again. Events respect RLS; handlers receive the raw new
  // row and decide relevance by rev.
  let _syncChannels = [];
  function unsubscribeSync() {
    _syncChannels.forEach((ch) => { try { sb.removeChannel(ch); } catch (e) {} });
    _syncChannels = [];
  }
  function subscribeSync(opts = {}) {
    unsubscribeSync();
    const mk = (name, table, filter, cb) => {
      const ch = sb.channel(name)
        .on("postgres_changes", { event: "*", schema: "public", table, filter }, (payload) => {
          try { cb(payload.new || null); } catch (e) { console.warn("[Cloud] realtime handler", e); }
        })
        .subscribe((status) => {
          // A (re)join means we may have missed events while away — the
          // caller's onLive typically runs a resync to close the gap.
          if (status === "SUBSCRIBED" && opts.onLive) { try { opts.onLive(); } catch (e) {} }
        });
      _syncChannels.push(ch);
    };
    if (opts.coachId && opts.onAthleteRow) mk("sync-roster", "athletes", `coach_id=eq.${opts.coachId}`, opts.onAthleteRow);
    if (opts.athleteId && opts.onAthleteRow) mk("sync-own-row", "athletes", `id=eq.${opts.athleteId}`, opts.onAthleteRow);
    if (opts.progressId && opts.onProgressRow) mk("sync-progress", "progress", `athlete_id=eq.${opts.progressId}`, opts.onProgressRow);
  }

  async function getProgress(athleteId) {
    if (!athleteId) return null;
    try {
      const { data, error } = await sb
        .from("progress")
        .select("*")
        .eq("athlete_id", athleteId)
        .maybeSingle();
      if (error) { console.warn("[Cloud] getProgress", error.message); return null; }
      return rowToProgress(data);
    } catch (e) { return null; }
  }

  async function upsertAthleteProfile(athleteId, profile) {
    if (!athleteId || !profile) return false;
    try {
      const { error } = await sb.from("athlete_profiles").upsert({
        athlete_id: athleteId,
        display_name: profile.name || "",
        pw_hash: "",
        email: profile.email || "",
      });
      if (error) console.warn("[Cloud] upsertAthleteProfile", error.message);
      return !error;
    } catch (e) { console.warn(e); return false; }
  }

  // -------- Bug reports --------
  // Insert is open (login-screen bugs happen pre-auth); reads are coach-only.
  async function submitBugReport(report) {
    try {
      const { error } = await sb.from("bug_reports").insert({
        reporter_role: report.role || "",
        reporter_name: report.name || "",
        athlete_id: report.athleteId || null,
        description: report.description || "",
        diagnostics: report.diagnostics || {},
      });
      if (error) { console.warn("[Cloud] submitBugReport", error.message); return false; }
      return true;
    } catch (e) { console.warn("[Cloud] submitBugReport", e); return false; }
  }
  async function getBugReports(limit = 50) {
    try {
      const { data, error } = await sb.from("bug_reports")
        .select("*")
        .order("created_at", { ascending: false })
        .limit(limit);
      if (error) { console.warn("[Cloud] getBugReports", error.message); return null; }
      return data || [];
    } catch (e) { console.warn("[Cloud] getBugReports", e); return null; }
  }
  async function deleteBugReport(id) {
    if (!id) return false;
    try {
      const { error } = await sb.from("bug_reports").delete().eq("id", id);
      if (error) { console.warn("[Cloud] deleteBugReport", error.message); return false; }
      return true;
    } catch (e) { console.warn("[Cloud] deleteBugReport", e); return false; }
  }

  // -------- Setmore calendar sync --------
  function rowToSetmoreEvent(r) {
    return {
      uid: r.external_uid,
      clientName: r.client_name || r.title || "Untitled",
      title: r.title || "",
      startAt: r.start_at,
      endAt: r.end_at,
    };
  }
  async function getSetmoreEvents(coachId, startISO, endISO) {
    if (!coachId) return [];
    try {
      let q = sb.from("setmore_events").select("*").eq("coach_id", coachId);
      if (startISO) q = q.gte("start_at", startISO);
      if (endISO) q = q.lte("start_at", endISO);
      const { data, error } = await q.order("start_at", { ascending: true });
      if (error) { console.warn("[Cloud] getSetmoreEvents", error.message); return []; }
      return (data || []).map(rowToSetmoreEvent);
    } catch (e) { console.warn("[Cloud] getSetmoreEvents", e); return []; }
  }
  // Cut the feed. The sync function selects coaches with a non-null
  // setmore_ics_url, so clearing it is what actually stops the job — the rows
  // already in setmore_events are left alone on purpose, since they are the
  // only record of sessions that happened before the app took over.
  async function clearSetmoreFeed(coachId) {
    if (!coachId) return false;
    try {
      const { error } = await sb.from("coaches")
        .update({ setmore_ics_url: null }).eq("id", coachId);
      if (error) { console.warn("[Cloud] clearSetmoreFeed", error.message); return false; }
      return true;
    } catch (e) { console.warn("[Cloud] clearSetmoreFeed", e); return false; }
  }
  // Manually trigger the sync Edge Function (the "Refresh now" button) —
  // the same job pg_cron runs on a schedule.
  async function refreshSetmoreSync() {
    try {
      const { error } = await sb.functions.invoke("sync-setmore", { body: {} });
      if (error) { console.warn("[Cloud] refreshSetmoreSync", error.message); return false; }
      return true;
    } catch (e) { console.warn("[Cloud] refreshSetmoreSync", e); return false; }
  }

  // -------- Debounce helper --------
  // Stores the pending fn alongside its timer so callers can force it to run
  // immediately via flush() (e.g. a Save button or when the page is hidden),
  // instead of waiting out the debounce window and risking loss on close.
  //
  // Instrumented for the sync-status chip: every queue/fire/settle transition
  // reports through onSyncActivity, and a failed push is a REPORTED state now
  // rather than a console line nobody reads. pendingPushes() counts both the
  // queued (timer not fired) and the in-flight (fired, unsettled) pushes, so
  // "everything is saved" can only be claimed when it is true.
  const _debounceTimers = new Map(); // key -> { timer, fn, seq }
  const _pushSeq = new Map();        // key -> the newest push issued for it
  const _retryAttempts = new Map();  // key -> consecutive failures, reset on success
  let _inflightPushes = 0;
  let _pushFailedAt = 0;
  let _syncCb = null;
  // Backoff for a push that failed. A failed push used to be DROPPED: the timer
  // had already fired and deleted the queue entry, so the function was gone —
  // nothing to flush, nothing for "Sync issue. Tap to retry" to retry, and on
  // the progress path `_progressDirtyAt` (app.js:294) stayed set forever, which
  // made the device refuse every pull AND every realtime event for the rest of
  // the session. Silent, and only a reload cleared it.
  const RETRY_MS = [5000, 15000, 45000, 120000];
  function onSyncActivity(cb) { _syncCb = typeof cb === "function" ? cb : null; }
  function pendingPushes() { return _debounceTimers.size + _inflightPushes; }
  function lastPushFailureAt() { return _pushFailedAt; }
  function _sync(evt) {
    if (!_syncCb) return;
    try { _syncCb(evt, pendingPushes()); } catch (e) { /* the chip must never break a push */ }
  }
  // Put a failed push back on the queue so flush() and the retry chip have
  // something to act on, and so reconnecting picks it up.
  function _requeue(key, fn, seq) {
    if (!key) return;                                  // a keyless direct push has no identity to retry under
    if ((_pushSeq.get(key) || 0) !== seq) return;      // superseded: a newer push for this key writes newer state
    // Offline is not a failed attempt, it is a wait. Burning the four attempts
    // against a plane or a lift with no signal would drop the work exactly
    // where the retry matters most, so hold at the longest interval instead and
    // let the `online` handler's flush fire it the moment there is a network.
    const offline = typeof navigator !== "undefined" && navigator.onLine === false;
    let wait;
    if (offline) {
      wait = RETRY_MS[RETRY_MS.length - 1];
    } else {
      const n = (_retryAttempts.get(key) || 0) + 1;
      if (n > RETRY_MS.length) return;                 // given up; _pushFailedAt keeps the chip red
      _retryAttempts.set(key, n);
      wait = RETRY_MS[n - 1];
    }
    const timer = setTimeout(() => {
      _debounceTimers.delete(key);
      _runPush(fn, key, seq);
    }, wait);
    _debounceTimers.set(key, { timer, fn, seq });
    _sync("queued");
  }
  function _runPush(fn, key, seq) {
    _inflightPushes++;
    _sync("push-start");
    return Promise.resolve(fn())
      .then((r) => { _pushFailedAt = 0; if (key) _retryAttempts.delete(key); return r; })
      .catch((e) => {
        _pushFailedAt = Date.now();
        console.warn("[Cloud] push failed", e);
        _requeue(key, fn, seq);
      })
      .finally(() => { _inflightPushes--; _sync("push-settled"); });
  }
  function debounce(key, fn, ms = 1500) {
    const prev = _debounceTimers.get(key);
    if (prev) clearTimeout(prev.timer);
    // A fresh push for this key supersedes anything older, including a retry
    // still waiting: it carries newer state, and it earns a clean set of
    // attempts.
    const seq = (_pushSeq.get(key) || 0) + 1;
    _pushSeq.set(key, seq);
    _retryAttempts.delete(key);
    const timer = setTimeout(() => {
      _debounceTimers.delete(key);
      _runPush(fn, key, seq);
    }, ms);
    _debounceTimers.set(key, { timer, fn, seq });
    _sync("queued");
  }
  // Immediately run any pending debounced calls (optionally only those whose key
  // starts with keyPrefix). Resolves once all have settled — settled, not
  // succeeded: individual failures are recorded in lastPushFailureAt(), and
  // callers that intend to PULL after a flush must check it before treating
  // local state as fully synced (see resyncNow in app.js).
  async function flush(keyPrefix) {
    const entries = [..._debounceTimers.entries()]
      .filter(([k]) => !keyPrefix || k.startsWith(keyPrefix));
    await Promise.all(entries.map(async ([k, entry]) => {
      clearTimeout(entry.timer);
      _debounceTimers.delete(k);
      await _runPush(entry.fn);
    }));
  }

  window.Cloud = {
    enabled: true,
    sb,
    // Auth
    signUp,
    signIn,
    signOut,
    signOutEverywhere,
    resetPassword,
    updatePassword,
    getSession,
    onAuthStateChange,
    // Coach
    upsertCoach,
    getCoachByAuthUserId,
    updateCoachTemplates,
    updateCoachLibraryPrefs,
    updateCoachAnatomyEdits,
    getAnatomyEditsForAthlete,
    // Open slots
    updateCoachOpenSlots,
    getCoachOpenSlots,
    getOpenSlotsForAthlete,
    claimOpenSlot,
    // Scheduling
    updateCoachAvailability,
    getCoachAvailability,
    getAvailabilityForAthlete,
    getBookedWindow,
    createBooking,
    createBookings,
    cancelBooking,
    updateBookingTime,
    cancelBookingSeries,
    getBookings,
    moveMyBooking,
    requestBookingChange,
    withdrawBookingRequest,
    resolveBookingRequest,
    getBookingRequests,
    notifyCoachOfRequest,
    googleCall,
    googleStatus,
    // Athlete
    upsertAthlete,
    deleteAthlete,
    unlinkAthleteAuth,
    getAthleteByInviteCode,
    getProgressByInviteCode,
    getAthleteById,
    getAthleteByAuthUserId,
    linkAthleteToAuth,
    updateAthleteCoachPRs,
    updateAthleteHideOpenSlots,
    updateAthleteCanBook,
    updateAthleteProfileFields,
    updateCoachAvatar,
    // Cycle tracking
    getMyCycle,
    saveMyCycle,
    deleteMyCycle,
    getCycleShares,
    // Messages
    sendMessage,
    getMessages,
    getAllMessages,
    markMessagesRead,
    // Progress
    upsertProgress,
    getProgress,
    upsertAthleteProfile,
    // Form-check videos
    uploadFormCheck,
    signedFormCheckUrl,
    deleteFormCheck,
    // Coach demo clips
    uploadExerciseDemo,
    signedExerciseDemoUrl,
    deleteExerciseDemo,
    // Billing (read-only from the client; writes are the webhook's alone)
    getBillingForCoach,
    getBillingForAthlete,
    squareBilling,
    getCardForAthlete,
    // Web push
    savePushSubscription,
    saveCoachPushSubscription,
    deletePushSubscription,
    deleteAllPushSubscriptions,
    sendPush,
    // Athlete preferences
    getAthletePrefs,
    saveAthletePrefs,
    // Food search
    searchFoodsOnline,
    // Setmore sync
    getSetmoreEvents,
    refreshSetmoreSync,
    clearSetmoreFeed,
    // Bug reports
    submitBugReport,
    getBugReports,
    deleteBugReport,
    // Utils
    debounce,
    flush,
    onSyncActivity,
    pendingPushes,
    lastPushFailureAt,
    onConflict,
    subscribeSync,
    unsubscribeSync,
    // Row mappers, exported for the realtime handlers in app.js — a
    // postgres_changes payload delivers the raw row.
    rowToAthlete,
    rowToProgress,
  };
  console.log("[Cloud] ready");
})();
