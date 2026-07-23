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
    try { await sb.auth.signOut(); } catch (e) { console.warn("[Cloud] signOut", e); }
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
      height_in: c.heightIn || null,
      weight_lb: c.weightLb || null,
      goals: c.goals || null,
      notes: c.notes || null,
      weeks: c.weeks || [],
      schedule: c.schedule || {},
      coach_prs: c.coachPRs || [],
      session_bank: c.sessionBank || { packages: [], redemptions: [] },
      one_off_days: c.oneOffDays || [],
      setmore_aliases: c.setmoreAliases || [],
      nutrition: c.nutrition || { current: null, history: [] },
      hide_open_slots: !!c.hideOpenSlots,
      partner_id: c.partnerId || null,
      updated_at: new Date().toISOString(),
    };
  }
  function rowToAthlete(r) {
    if (!r) return null;
    return {
      id: r.id,
      name: r.display_name,
      inviteCode: r.invite_code,
      age: r.age || "",
      heightIn: r.height_in || "",
      weightLb: r.weight_lb || "",
      goals: r.goals || "",
      notes: r.notes || "",
      weeks: r.weeks || [],
      schedule: r.schedule || {},
      coachPRs: r.coach_prs || [],
      sessionBank: r.session_bank || { packages: [], redemptions: [] },
      oneOffDays: r.one_off_days || [],
      setmoreAliases: r.setmore_aliases || [],
      nutrition: r.nutrition || { current: null, history: [] },
      hideOpenSlots: !!r.hide_open_slots,
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
      added_exercises: p.addedExercises || {},
      form_checks: p.formChecks || {},
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
      addedExercises: r.added_exercises || {},
      formChecks: r.form_checks || {},
      syncedAt: r.synced_at,
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
      return { coach, athletes: (athletes || []).map(rowToAthlete) };
    } catch (e) { console.warn("[Cloud] getCoachByAuthUserId", e); return null; }
  }

  // Coach's reusable program/workout template library — shared across every
  // device the coach signs into, not just the one that created it.
  async function updateCoachTemplates(coachId, programTemplates, workoutTemplates) {
    if (!coachId) return false;
    try {
      const { error } = await sb.from("coaches").update({
        program_templates: programTemplates || [],
        workout_templates: workoutTemplates || [],
      }).eq("id", coachId);
      if (error) console.warn("[Cloud] updateCoachTemplates error", error.message);
      return !error;
    } catch (e) { console.warn("[Cloud] updateCoachTemplates", e); return false; }
  }

  // Coach's exercise-library customizations (custom exercises, hidden list,
  // category order) — one jsonb blob so they follow the coach across devices.
  async function updateCoachLibraryPrefs(coachId, prefs) {
    if (!coachId) return false;
    try {
      const { error } = await sb.from("coaches").update({
        library_prefs: prefs || {},
      }).eq("id", coachId);
      if (error) console.warn("[Cloud] updateCoachLibraryPrefs error", error.message);
      return !error;
    } catch (e) { console.warn("[Cloud] updateCoachLibraryPrefs", e); return false; }
  }

  // -------- Anatomy edits (coach curates the Anatomy/Science page) --------
  // Coach writes their own row; athletes read via SECURITY DEFINER RPC.
  async function updateCoachAnatomyEdits(coachId, edits) {
    if (!coachId) return false;
    try {
      const { error } = await sb.from("coaches").update({ anatomy_edits: edits || {} }).eq("id", coachId);
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
  async function upsertAthlete(athlete, coachId) {
    const row = athleteToRow(athlete, coachId);
    if (!row) return false;
    try {
      const { error } = await sb.from("athletes").upsert(row);
      if (error) console.warn("[Cloud] upsertAthlete error", error.message);
      return !error;
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
  async function updateAthleteCoachPRs(athleteId, coachPRs) {
    if (!athleteId) return false;
    try {
      const { error } = await sb.from("athletes").update({ coach_prs: coachPRs || [] }).eq("id", athleteId);
      if (error) console.warn("[Cloud] updateAthleteCoachPRs error", error.message);
      return !error;
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

  // Athlete self-edits their own vitals (name / age / height / weight / goals)
  // on the shared athletes row so the coach sees the same information.
  async function updateAthleteProfileFields(athleteId, fields) {
    if (!athleteId || !fields) return false;
    try {
      const row = { updated_at: new Date().toISOString() };
      if ("name" in fields) row.display_name = fields.name || "";
      if ("age" in fields) row.age = fields.age || null;
      if ("heightIn" in fields) row.height_in = fields.heightIn || null;
      if ("weightLb" in fields) row.weight_lb = fields.weightLb || null;
      if ("goals" in fields) row.goals = fields.goals || null;
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
  async function deletePushSubscription(endpoint) {
    if (!endpoint) return false;
    try {
      const { error } = await sb.from("push_subscriptions").delete().eq("endpoint", endpoint);
      if (error) { console.warn("[Cloud] deletePushSubscription", error.message); return false; }
      return true;
    } catch (e) { console.warn("[Cloud] deletePushSubscription", e); return false; }
  }
  async function sendPush(athleteIds, title, body, url) {
    try {
      const { data, error } = await sb.functions.invoke("send-push", {
        body: { athleteIds, title, body, url },
      });
      if (error) { console.warn("[Cloud] sendPush", error.message || error); return null; }
      return data;
    } catch (e) { console.warn("[Cloud] sendPush", e); return null; }
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

  // -------- Progress methods --------
  async function upsertProgress(athleteId, progress) {
    if (!athleteId) return false;
    try {
      const { error } = await sb.from("progress").upsert(progressToRow(progress, athleteId));
      if (error) console.warn("[Cloud] upsertProgress error", error.message);
      return !error;
    } catch (e) { console.warn("[Cloud] upsertProgress", e); return false; }
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
  const _debounceTimers = new Map(); // key -> { timer, fn }
  function debounce(key, fn, ms = 1500) {
    const prev = _debounceTimers.get(key);
    if (prev) clearTimeout(prev.timer);
    const timer = setTimeout(() => {
      _debounceTimers.delete(key);
      Promise.resolve(fn()).catch((e) => console.warn("[Cloud] debounced call failed", e));
    }, ms);
    _debounceTimers.set(key, { timer, fn });
  }
  // Immediately run any pending debounced calls (optionally only those whose key
  // starts with keyPrefix). Resolves once all have settled.
  async function flush(keyPrefix) {
    const entries = [..._debounceTimers.entries()]
      .filter(([k]) => !keyPrefix || k.startsWith(keyPrefix));
    await Promise.all(entries.map(async ([k, entry]) => {
      clearTimeout(entry.timer);
      _debounceTimers.delete(k);
      try { await entry.fn(); } catch (e) { console.warn("[Cloud] flush failed", e); }
    }));
  }

  window.Cloud = {
    enabled: true,
    sb,
    // Auth
    signUp,
    signIn,
    signOut,
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
    updateAthleteProfileFields,
    // Progress
    upsertProgress,
    getProgress,
    upsertAthleteProfile,
    // Form-check videos
    uploadFormCheck,
    signedFormCheckUrl,
    deleteFormCheck,
    // Web push
    savePushSubscription,
    deletePushSubscription,
    sendPush,
    // Setmore sync
    getSetmoreEvents,
    refreshSetmoreSync,
    // Bug reports
    submitBugReport,
    getBugReports,
    deleteBugReport,
    // Utils
    debounce,
    flush,
  };
  console.log("[Cloud] ready");
})();
