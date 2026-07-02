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
    if (!data.user) throw new Error("Sign-up failed — try again or sign in if you already have an account.");
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
      feedback: p.feedback || "",
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
      feedback: r.feedback || "",
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

  async function getAthleteByInviteCode(code) {
    try {
      const { data, error } = await sb
        .from("athletes")
        .select("*")
        .eq("invite_code", code)
        .maybeSingle();
      if (error) { console.warn("[Cloud] getAthleteByInviteCode", error.message); return null; }
      return rowToAthlete(data);
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

  async function linkAthleteToAuth(athleteId, authUserId, email) {
    if (!athleteId || !authUserId) return false;
    try {
      const { error: ae } = await sb.from("athletes")
        .update({ auth_user_id: authUserId })
        .eq("id", athleteId);
      if (ae) console.warn("[Cloud] linkAthleteToAuth athletes", ae.message);
      await sb.from("athlete_profiles").upsert({
        athlete_id: athleteId,
        display_name: "",
        pw_hash: "",
        email: email || "",
      });
      return !ae;
    } catch (e) { console.warn("[Cloud] linkAthleteToAuth", e); return false; }
  }

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

  // -------- Debounce helper --------
  const _debounceTimers = new Map();
  function debounce(key, fn, ms = 1500) {
    const prev = _debounceTimers.get(key);
    if (prev) clearTimeout(prev);
    _debounceTimers.set(key, setTimeout(() => {
      _debounceTimers.delete(key);
      Promise.resolve(fn()).catch((e) => console.warn("[Cloud] debounced call failed", e));
    }, ms));
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
    // Athlete
    upsertAthlete,
    deleteAthlete,
    getAthleteByInviteCode,
    getAthleteById,
    getAthleteByAuthUserId,
    linkAthleteToAuth,
    updateAthleteCoachPRs,
    // Progress
    upsertProgress,
    getProgress,
    upsertAthleteProfile,
    // Utils
    debounce,
  };
  console.log("[Cloud] ready");
})();
