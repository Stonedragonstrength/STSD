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
      setmore_aliases: c.setmoreAliases || [],
      nutrition: c.nutrition || { current: null, history: [] },
      hide_open_slots: !!c.hideOpenSlots,
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
      setmoreAliases: r.setmore_aliases || [],
      nutrition: r.nutrition || { current: null, history: [] },
      hideOpenSlots: !!r.hide_open_slots,
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
    // Open slots
    updateCoachOpenSlots,
    getCoachOpenSlots,
    getOpenSlotsForAthlete,
    claimOpenSlot,
    // Athlete
    upsertAthlete,
    deleteAthlete,
    getAthleteByInviteCode,
    getProgressByInviteCode,
    getAthleteById,
    getAthleteByAuthUserId,
    linkAthleteToAuth,
    updateAthleteCoachPRs,
    // Progress
    upsertProgress,
    getProgress,
    upsertAthleteProfile,
    // Setmore sync
    getSetmoreEvents,
    refreshSetmoreSync,
    // Utils
    debounce,
  };
  console.log("[Cloud] ready");
})();
