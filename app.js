/* ============ Stone Dragon Strength Training — app.js ============ */
(function () {
  "use strict";

  // -------- Storage --------
  const KEY_TRAINER = "trainerpro_data_v1";
  const KEY_CLIENT  = "trainerpro_client_v1";
  const KEY_SESSION = "trainerpro_session_v1";
  // Set while a coach-template edit is saved locally but not yet confirmed pushed
  // to the cloud. Guards boot from overwriting unsynced local work with a stale
  // cloud copy (the cause of "my in-progress program disappeared").
  const KEY_TEMPLATES_DIRTY = "trainerpro_templates_dirty_v1";
  const KEY_ATHLETES_DIRTY = "trainerpro_athletes_dirty_v1";
  // Same guard for the coach's exercise-library customizations (custom
  // exercises, hidden list, category order) — synced as one blob.
  const KEY_LIBPREFS_DIRTY = "trainerpro_libprefs_dirty_v1";

  // Public deployed URL — used in shareable links (invite emails, app-link
  // copy). Hardcoded so links point at production even from local dev.
  const APP_URL = "https://stonedragonstrength.github.io/STSD/";

  // -------- Color themes (full recolor, per role) --------
  // "blue" is the original (default :root, no data-theme attribute). Each role
  // (coach / athlete) remembers its own pick under KEY_THEME.
  const KEY_THEME = "trainerpro_theme_v1";
  const THEMES = [
    { id: "blue",   name: "Blue",   swatch: "#22d3ee" },
    { id: "teal",   name: "Teal",   swatch: "#2dd4bf" },
    { id: "green",  name: "Green",  swatch: "#5eea8d" },
    { id: "yellow", name: "Yellow", swatch: "#fbbf24" },
    { id: "orange", name: "Orange", swatch: "#fb923c" },
    { id: "red",    name: "Red",    swatch: "#f87171" },
    { id: "pink",   name: "Pink",   swatch: "#f472b6" },
    { id: "purple", name: "Purple", swatch: "#c084fc" },
    { id: "black",  name: "Black",  swatch: "#0b0b0d" },
    { id: "white",  name: "White",  swatch: "#ffffff" },
  ];
  function getThemePrefs() {
    try { return JSON.parse(localStorage.getItem(KEY_THEME)) || {}; } catch { return {}; }
  }
  function currentThemeForRole(role) { return getThemePrefs()[role] || "blue"; }
  function applyTheme(id) {
    if (!id || id === "blue") document.documentElement.removeAttribute("data-theme");
    else document.documentElement.setAttribute("data-theme", id);
    syncStatusBarColor();
  }
  // Point the browser/PWA status bar (phone's top bar) at the active theme's
  // background so it matches instead of staying the old cyan. The OS auto-picks
  // white or dark clock/battery text based on how dark this color is.
  function syncStatusBarColor() {
    const meta = document.querySelector('meta[name="theme-color"]');
    if (!meta) return;
    const bg = getComputedStyle(document.documentElement).getPropertyValue("--bg").trim();
    if (bg) meta.setAttribute("content", bg);
  }
  function setThemeForRole(role, id) {
    const prefs = getThemePrefs(); prefs[role] = id;
    localStorage.setItem(KEY_THEME, JSON.stringify(prefs));
    applyTheme(id);
  }
  // Swatch grid — pass "coach" or "athlete". Re-renders itself on pick.
  function renderThemePicker(container, role) {
    if (!container) return;
    container.innerHTML = "";
    const current = currentThemeForRole(role);
    THEMES.forEach((t) => {
      const btn = document.createElement("button");
      btn.type = "button";
      btn.className = "theme-swatch" + (t.id === current ? " on" : "");
      btn.style.setProperty("--sw", t.swatch);
      btn.title = t.name;
      btn.innerHTML = `<span class="theme-swatch-dot"></span><span class="theme-swatch-name">${t.name}</span>`;
      btn.addEventListener("click", () => { setThemeForRole(role, t.id); renderThemePicker(container, role); });
      container.appendChild(btn);
    });
  }

  // Auth state flags
  let _signOutOnLeave = false;  // set when "Remember me" is unchecked
  let _forgotFromPanel = "#login-signin";  // tracks which signin panel opened forgot-password

  const DEFAULT_TRAINER = { trainer: null, clients: [] };
  const DEFAULT_CLIENT = { program: null, progress: null };

  function loadJSON(key, fallback) {
    try {
      const raw = localStorage.getItem(key);
      if (!raw) return structuredClone(fallback);
      return { ...structuredClone(fallback), ...JSON.parse(raw) };
    } catch {
      return structuredClone(fallback);
    }
  }
  // ── Unsynced-athlete protection ──
  // Every coach boot refreshes athletes from the cloud and replaces the local
  // list. Cloud writes fail silently by design (offline always works), so a
  // push that never landed used to be reverted on the next open with no
  // warning — a program assigned on flaky signal would simply vanish.
  // Templates already had this guard via KEY_TEMPLATES_DIRTY; athletes didn't.
  // An athlete stays marked dirty until the cloud confirms the write, and a
  // dirty athlete's local copy survives the refresh. See populateCoachFromCloud.
  function dirtyAthletes() {
    try { return JSON.parse(localStorage.getItem(KEY_ATHLETES_DIRTY)) || {}; }
    catch { return {}; }
  }
  function markAthleteDirty(id) {
    if (!id) return;
    const d = dirtyAthletes();
    if (d[id]) return;
    d[id] = true;
    localStorage.setItem(KEY_ATHLETES_DIRTY, JSON.stringify(d));
  }
  function clearAthleteDirty(id) {
    const d = dirtyAthletes();
    if (!d[id]) return;
    delete d[id];
    localStorage.setItem(KEY_ATHLETES_DIRTY, JSON.stringify(d));
  }
  function pushAthlete(c) {
    if (!window.Cloud?.enabled || !c) return;
    markAthleteDirty(c.id);
    window.Cloud.debounce(`athlete:${c.id}`, async () => {
      const ok = await window.Cloud.upsertAthlete(c, state.trainerData.coachId);
      if (ok) clearAthleteDirty(c.id); // confirmed in the cloud
    });
  }

  function saveTrainer() {
    localStorage.setItem(KEY_TRAINER, JSON.stringify(state.trainerData));
    // Editing a program template live-syncs every athlete it's assigned to.
    if (_programEditorId) scheduleTemplateSync(_programEditorId);
    // Cloud: debounced push of the client we're currently editing.
    if (window.Cloud?.enabled && state.currentClientId) {
      const c = state.trainerData.clients.find((x) => x.id === state.currentClientId);
      if (c) pushAthlete(c);
    }
    // Cloud: debounced push of the coach's program/workout template library,
    // so templates created on one device show up on every other device.
    if (window.Cloud?.enabled && state.trainerData.coachId) {
      localStorage.setItem(KEY_TEMPLATES_DIRTY, "1");
      window.Cloud.debounce(`coach-templates:${state.trainerData.coachId}`, async () => {
        const ok = await window.Cloud.updateCoachTemplates(
          state.trainerData.coachId,
          state.trainerData.programTemplates,
          state.trainerData.workoutTemplates
        );
        // Only on success. This used to clear unconditionally, so a failed push
        // was recorded as synced and the next boot overwrote the local
        // templates from the cloud — losing the program outright.
        if (ok) localStorage.removeItem(KEY_TEMPLATES_DIRTY);
      });
    }
    // Cloud: debounced push of the coach's exercise-library customizations.
    pushCoachLibPrefs();
  }

  // Push the coach's per-account preferences jsonb blob (exercise-library
  // customizations, athlete templates, and the read-activity marks). Rides one
  // Supabase column so there's no per-field migration. Called both from
  // saveTrainer and from saveSeenActivity, since dismissing an athlete's
  // workout activity must reach the coach's other devices too.
  function pushCoachLibPrefs() {
    if (!window.Cloud?.enabled || !state.trainerData.coachId) return;
    localStorage.setItem(KEY_LIBPREFS_DIRTY, "1");
    window.Cloud.debounce(`coach-libprefs:${state.trainerData.coachId}`, async () => {
      const ok = await window.Cloud.updateCoachLibraryPrefs(state.trainerData.coachId, {
        customExercises: state.trainerData.customExercises || [],
        hiddenExercises: state.trainerData.hiddenExercises || [],
        exCatOrder: state.trainerData.exCatOrder || [],
        // Athlete Templates ride this existing jsonb blob rather than needing
        // a new Supabase column — no migration to run against live data.
        athleteTemplates: state.trainerData.athleteTemplates || [],
        templateFolders: state.trainerData.templateFolders || [],
        // Which athlete-activity rows this coach has marked read. Synced so a
        // dismissal on one device clears the "New activity" card on all of them.
        seenActivity: state.trainerData.seenActivity || {},
      });
      if (ok) localStorage.removeItem(KEY_LIBPREFS_DIRTY); // confirmed in the cloud
    });
  }
  function saveClient() {
    if (state.tourDemo) return; // demo program during the tour — never persist
    if (state.previewMode) {
      // Read-only preview — never persist or push.
      if (!state.liveLog) return;
      // Live session: the coach is logging on the athlete's behalf. Mirror
      // the progress into the coach's own copy and push it to the athlete's
      // cloud row (RLS lets a coach write their own athletes' progress).
      const liveAthleteId = state.clientData.program?.clientId;
      const liveClient = state.trainerData.clients.find((x) => x.id === liveAthleteId);
      if (!liveClient) return;
      liveClient.importedProgress = { ...structuredClone(state.clientData.progress), syncedAt: Date.now() };
      localStorage.setItem(KEY_TRAINER, JSON.stringify(state.trainerData));
      if (window.Cloud?.enabled) {
        const snap = liveClient.importedProgress; // capture — exitPreview swaps state.clientData back
        window.Cloud.debounce(`progress:${liveAthleteId}`, () => window.Cloud.upsertProgress(liveAthleteId, snap));
      }
      return;
    }
    localStorage.setItem(KEY_CLIENT, JSON.stringify(state.clientData));
    // Cloud: debounced push of athlete progress.
    const athleteId = state.clientData.program?.clientId;
    if (window.Cloud?.enabled && athleteId && state.clientData.progress) {
      window.Cloud.debounce(`progress:${athleteId}`, () =>
        window.Cloud.upsertProgress(athleteId, state.clientData.progress)
      );
    }
  }

  function uid() { return Date.now().toString(36) + Math.random().toString(36).slice(2, 8); }

  function makeInviteCode() {
    // Readable code: omits 0, O, 1, I to avoid confusion. Format XXXX-XXXX.
    const chars = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
    let s = "";
    for (let i = 0; i < 8; i++) s += chars[Math.floor(Math.random() * chars.length)];
    return s.slice(0, 4) + "-" + s.slice(4);
  }
  function normalizeInviteCode(s) {
    return String(s || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 8);
  }
  function formatInviteInput(raw) {
    const n = normalizeInviteCode(raw);
    return n.length > 4 ? n.slice(0, 4) + "-" + n.slice(4) : n;
  }

  function todayISO() {
    const d = new Date();
    const tz = d.getTimezoneOffset() * 60000;
    return new Date(d - tz).toISOString().slice(0, 10);
  }
  function dateISO(d) {
    const tz = d.getTimezoneOffset() * 60000;
    return new Date(d - tz).toISOString().slice(0, 10);
  }
  function decodeData(str) {
    const cleaned = String(str).replace(/\s+/g, "");
    const json = decodeURIComponent(escape(atob(cleaned)));
    return JSON.parse(json);
  }

  // -------- Program editor state --------
  // When set, renderWeeks/addWeek operate on this template instead of the current client.
  let _programEditorId = null;
  let _coachActiveWeekIdx = 0;
  let _prEditIds = new Set();
  let _exLibraryTarget = null; // { day, rerenderFn } (coach) or { onAdd } (athlete) — set by openExLibrary()/openAthleteExLibrary(), used for tap-to-add
  // Athletes can add their own exercises to a day on the fly (stored in progress
  // so they survive coach re-syncs and reach the coach), capped to prevent abuse.
  const MAX_ADDED_PER_DAY = 8;
  let _focusQuickAddDayId = null; // day id whose type-to-add input should refocus after a rerender
  const _coachMobOpen = new Set(); // day ids whose coach-side mobility section is expanded
  let _prNewLifts = [];
  let _prDragSrcId = null;
  function currentProgramTemplate() {
    return (state.trainerData.programTemplates || []).find((p) => p.id === _programEditorId) || null;
  }

  // -------- Data factories --------
  const DEFAULT_PR_LIFTS = ["Barbell Squat", "Deadlift", "Bench Press", "DB Bench Press", "Overhead BB Press", "Strict Curl"];
  function makeClient(name) {
    return {
      id: uid(), name: name || "New Athlete",
      age: "", heightIn: "", weightLb: "",
      goals: "", notes: "",
      weeks: [],
      oneOffDays: [],
      schedule: {},
      coachPRs: DEFAULT_PR_LIFTS.map((n) => ({ id: uid(), name: n, pr1: "", pr2: "", pr3: "" })),
      // Seed with any active bulletins so a new athlete sees current notices.
      sessionBank: { packages: [], redemptions: [], bulletins: activeCoachBulletins().map((b) => ({ ...b })) },
      archivedPrograms: [],
      inviteCode: makeInviteCode(),
      importedProgress: null,
      createdAt: Date.now(),
    };
  }
  function ensureSessionBank(c) {
    if (!c) return;
    if (!c.sessionBank || typeof c.sessionBank !== "object") c.sessionBank = { packages: [], redemptions: [] };
    if (!Array.isArray(c.sessionBank.packages)) c.sessionBank.packages = [];
    if (!Array.isArray(c.sessionBank.redemptions)) c.sessionBank.redemptions = [];
    // Upcoming Setmore bookings the coach has matched to this athlete — rides
    // the existing session_bank jsonb so the athlete sees them on their calendar
    // (no schema change). See syncUpcomingBookingsToAthletes().
    if (!Array.isArray(c.sessionBank.upcomingBookings)) c.sessionBank.upcomingBookings = [];
    // Missed-session markers (close-call freebie vs charged) — also rides the
    // session_bank jsonb so the athlete's calendar shows them. See
    // markBookingMissed().
    if (!Array.isArray(c.sessionBank.missedSessions)) c.sessionBank.missedSessions = [];
    // Coach → athlete announcements — rides the existing session_bank jsonb
    // (coach-write-only column, so no athlete/coach write conflict; no schema
    // change). The athlete reads these read-only on their Overview.
    if (!Array.isArray(c.sessionBank.messages)) c.sessionBank.messages = [];
    // Coach bulletin board — the same time-boxed notice mirrored to every
    // athlete. The coach's board is the union of these across athletes.
    if (!Array.isArray(c.sessionBank.bulletins)) c.sessionBank.bulletins = [];
  }
  function sessionBankSummary(c) {
    ensureSessionBank(c);
    const granted = c.sessionBank.packages
      .filter((p) => p.status === "paid")
      .reduce((n, p) => n + (Number(p.size) || 0), 0);
    const used = c.sessionBank.redemptions.length;
    const pendingCount = c.sessionBank.packages.filter((p) => p.status === "pending").length;
    return { granted, used, remaining: granted - used, pendingCount };
  }

  // -------- Partner link (couples share one session bank) --------
  // Linked partners (partnerId set both ways) carry identical copies of the
  // bank's money fields, so either athlete's app shows the shared balance with
  // no athlete-side changes — each athlete can still only read their own row.
  // bankMutated(c) is the one choke point: call it after ANY money mutation and
  // it clones those fields onto the partner and cloud-pushes their row.
  // messages/bulletins/upcomingBookings stay per-athlete (bookings get a
  // partner union in syncUpcomingBookingsToAthletes instead, so the couple's
  // shared slot shows on both calendars). The mirrored membership/autoRenew +
  // the mirrored monthKey grant guard keep auto-renew from double-granting.
  function partnerOf(c) {
    if (!c?.partnerId) return null;
    return (state.trainerData.clients || []).find((x) => x.id === c.partnerId) || null;
  }
  function bankMutated(c) {
    const p = partnerOf(c);
    if (!p) return;
    ensureSessionBank(c); ensureSessionBank(p);
    p.sessionBank.packages = structuredClone(c.sessionBank.packages);
    p.sessionBank.redemptions = structuredClone(c.sessionBank.redemptions);
    p.sessionBank.missedSessions = structuredClone(c.sessionBank.missedSessions);
    p.sessionBank.membership = c.sessionBank.membership;
    p.sessionBank.autoRenew = c.sessionBank.autoRenew;
    if (window.Cloud?.enabled) window.Cloud.debounce(`athlete:${p.id}`, () =>
      window.Cloud.upsertAthlete(p, state.trainerData.coachId));
  }
  function linkPartners(a, b) {
    ensureSessionBank(a); ensureSessionBank(b);
    // Merge both histories into one shared bank (id-less legacy rows kept).
    const dedupe = (arr) => {
      const seen = new Set();
      return arr.filter((x) => {
        if (!x) return false;
        if (!x.id) return true;
        if (seen.has(x.id)) return false;
        seen.add(x.id); return true;
      });
    };
    a.sessionBank.packages = dedupe([...a.sessionBank.packages, ...b.sessionBank.packages]);
    a.sessionBank.redemptions = dedupe([...a.sessionBank.redemptions, ...b.sessionBank.redemptions]);
    a.sessionBank.missedSessions = dedupe([...a.sessionBank.missedSessions, ...b.sessionBank.missedSessions]);
    a.sessionBank.membership = a.sessionBank.membership || b.sessionBank.membership;
    a.sessionBank.autoRenew = !!(a.sessionBank.autoRenew || b.sessionBank.autoRenew);
    a.partnerId = b.id;
    b.partnerId = a.id;
    bankMutated(a); // clones the merged bank onto b and pushes b's row
    saveTrainer();
    toast(`💞 ${a.name} & ${b.name} now share one session bank`);
  }
  function unlinkPartner(c) {
    const p = partnerOf(c);
    if (!window.confirm(`Unlink ${c.name}${p ? ` and ${p.name}` : ""}? Both keep a copy of the current balance and history, then they're tracked separately.`)) return;
    c.partnerId = null;
    if (p) {
      p.partnerId = null;
      if (window.Cloud?.enabled) window.Cloud.debounce(`athlete:${p.id}`, () =>
        window.Cloud.upsertAthlete(p, state.trainerData.coachId));
    }
    saveTrainer();
    renderCoachSessions();
    toast("Partner link removed");
  }
  function openLinkPartnerModal(c) {
    const candidates = (state.trainerData.clients || [])
      .filter((x) => x.id !== c.id && !x.partnerId)
      .sort((x, y) => (x.name || "").localeCompare(y.name || ""));
    if (!candidates.length) { toast("No unlinked athletes to pair with"); return; }
    openModal({
      title: "Link a partner",
      body: `
        <p class="muted" style="margin-top:-0.4em">Their session banks merge into one shared balance: every package, redemption, and the monthly close call applies to both. A booking they share spends one session. Programs are not affected.</p>
        <label>Partner
          <select id="partner-select">${candidates.map((x) => `<option value="${escapeHtml(x.id)}">${escapeHtml(x.name || "(unnamed)")}</option>`).join("")}</select>
        </label>`,
      actions: [
        { label: "Cancel", className: "btn btn-ghost", onClick: closeModal },
        {
          label: "Link 💞", className: "btn btn-primary",
          onClick: () => {
            const p = (state.trainerData.clients || []).find((x) => x.id === $("#partner-select").value);
            if (!p) return;
            closeModal();
            linkPartners(c, p);
            renderCoachSessions();
          },
        },
      ],
    });
  }
  function makePR(seed) {
    return {
      id: uid(),
      name: (seed?.name || "").trim(),
      weight: seed?.weight || "",
      reps: seed?.reps || "",
      date: seed?.date || todayISO(),
      notes: seed?.notes || "",
      auto: !!seed?.auto, // detected from logged sets vs. hand-entered
    };
  }
  // Estimated 1-rep max (Epley): weight × (1 + reps/30). One comparable number
  // so a heavy low-rep set and a lighter high-rep set can be ranked fairly —
  // 225×5 (≈262) correctly outranks 235×1 (≈243).
  function epley1RM(w, r) { return (parseFloat(w) || 0) * (1 + (parseInt(r, 10) || 0) / 30); }
  // Stable-ish identity for matching a lift's history across program copies:
  // case-, whitespace-, and trailing-punctuation-insensitive so "Bench Press",
  // "bench  press" and "Bench Press." all count as the same lift.
  function exKey(name) { return String(name || "").trim().toLowerCase().replace(/\s+/g, " ").replace(/[.,;:!]+$/, ""); }
  // A PR (or set) with no real barbell weight is judged by reps (bodyweight
  // lifts like pull-ups, and any weightless entry).
  function prIsRepOnly(p) { const w = Number(p && p.weight); return !(isFinite(w) && w > 0); }
  function makeWeek(index, label, focus, phaseLabel) {
    return {
      id: uid(),
      label: label || `Week ${index + 1}`,
      focus: focus || "",
      phaseLabel: phaseLabel || "",
      days: [],
      diet: {
        notes: "",
        calories: "",
        protein: "",
      },
    };
  }
  function makeDay(n, name) {
    return { id: uid(), name: name || `Day ${n}`, exercises: [] };
  }
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

  const EXERCISE_MODIFIERS = [
    { group: "Unilateral",  tags: ["1A", "1L"] },
    { group: "Alternation", tags: ["Alternating", "Non-Alternating"] },
    { group: "Equipment",   tags: ["BB", "DB", "DBs", "KB", "EZ Bar", "Cable", "Rope", "Wide Bar", "Band", "Machine", "Landmine", "Bench"], multi: true },
    { group: "Position",    tags: ["Incline", "Decline", "Elevated", "Seated", "Standing", "Kneeling", "Raised", "Supported"] },
    { group: "Grip",        tags: ["Supinated", "Neutral", "Pronated"] },
    { group: "Style",       tags: ["Pause", "Tempo", "Explosive", "Isometric"] },
    { group: "Hold",        tags: ["1S", "2S", "3S", "4S", "5S"] },
  ];
  // Hold (seconds) tags only apply alongside the Isometric tag.
  const HOLD_TAGS = ["1S", "2S", "3S", "4S", "5S"];

  // Tags that contradict each other and can't be held at once, even inside a
  // multi-select group like Equipment (where Cable + Rope etc. is legitimate).
  // DB is one dumbbell, DBs is a pair — they drive usesDumbbellPair(), which
  // decides whether the weight reads "50 lb" or "50s", so holding both is
  // ambiguous. Add further pairs here rather than special-casing the picker.
  const EXCLUSIVE_TAGS = [["DB", "DBs"]];
  function conflictingTags(tag) {
    const out = [];
    EXCLUSIVE_TAGS.forEach((set) => {
      if (set.includes(tag)) set.forEach((t) => { if (t !== tag) out.push(t); });
    });
    return out;
  }
  // Repairs an exercise saved before the rule existed (or synced from an older
  // client): keeps whichever of the conflicting tags comes last in the list.
  function dropConflictingTags(ex) {
    const mods = ex && ex.modifiers;
    if (!Array.isArray(mods)) return false;
    let changed = false;
    EXCLUSIVE_TAGS.forEach((set) => {
      const held = set.filter((t) => mods.includes(t));
      if (held.length < 2) return;
      const keep = held[held.length - 1];
      ex.modifiers = ex.modifiers.filter((m) => !set.includes(m) || m === keep);
      changed = true;
    });
    return changed;
  }

  // "DBs" = a pair of dumbbells — the weight reads plural gym-style ("50s").
  // "DB" = a single dumbbell — reads "50 lb". BW passes through untouched.
  // (Before the 2026-07-17 split there was one DB tag whose plurality was
  // inferred from 1A/1L; the boot migration rewrote those pairs to DBs.)
  function usesDumbbellPair(ex) {
    const mods = (ex && ex.modifiers) || [];
    return mods.includes("DBs");
  }
  // Carry-type exercises are prescribed and logged as weight × TIME (seconds),
  // never reps. Library carries qualify by name; coach-made ones persist
  // ex.timed from makeExercise. (kind stays "strength" — weights still apply,
  // unlike mobility holds.)
  function exIsTimed(ex) {
    return !!ex && (ex.timed === true || isCarryName(ex.name));
  }
  // "BAR" is a weight sentinel for the empty Olympic barbell: it displays as
  // "BAR" everywhere but counts as 45 lb wherever weight becomes a number.
  const BAR_LB = 45;
  function weightToLb(v) { return v === "BAR" ? BAR_LB : parseFloat(v); }
  function exWeightLabel(ex, v) {
    if (!v) return null;
    if (v === "BW") return "BW";
    if (v === "BAR") return "BAR";
    return usesDumbbellPair(ex) ? v + "s" : v + " lb";
  }

  const TAG_COLORS = {
    "1A":        { color: "#f87171", bg: "rgba(248,113,113,0.18)" },
    "1L":        { color: "#fb923c", bg: "rgba(251,146,60,0.18)"  },
    "Alternating":     { color: "#ec4899", bg: "rgba(236,72,153,0.18)"  },
    "Non-Alternating": { color: "#64748b", bg: "rgba(100,116,139,0.18)" },
    "BB":        { color: "#818cf8", bg: "rgba(129,140,248,0.18)" },
    "DB":        { color: "#60a5fa", bg: "rgba(96,165,250,0.18)"  },
    "DBs":       { color: "#93c5fd", bg: "rgba(147,197,253,0.18)" },
    "KB":        { color: "#a78bfa", bg: "rgba(167,139,250,0.18)" },
    "EZ Bar":    { color: "#c084fc", bg: "rgba(192,132,252,0.18)" },
    "Cable":     { color: "#2dd4bf", bg: "rgba(45,212,191,0.18)"  },
    "Rope":      { color: "#38bdf8", bg: "rgba(56,189,248,0.18)"  },
    "Wide Bar":  { color: "#22d3ee", bg: "rgba(34,211,238,0.18)"  },
    "Band":      { color: "#4ade80", bg: "rgba(74,222,128,0.18)"  },
    "Machine":   { color: "#facc15", bg: "rgba(250,204,21,0.18)"  },
    "Landmine":  { color: "#d97706", bg: "rgba(217,119,6,0.18)"   },
    "Incline":   { color: "#fbbf24", bg: "rgba(251,191,36,0.18)"  },
    "Decline":   { color: "#f97316", bg: "rgba(249,115,22,0.18)"  },
    "Elevated":  { color: "#22d3ee", bg: "rgba(34,211,238,0.18)"  },
    "Seated":    { color: "#a3e635", bg: "rgba(163,230,53,0.18)"  },
    "Standing":  { color: "#e879f9", bg: "rgba(232,121,249,0.18)" },
    "Kneeling":  { color: "#f43f5e", bg: "rgba(244,63,94,0.18)"   },
    "Raised":    { color: "#f472b6", bg: "rgba(244,114,182,0.18)" },
    "Supinated": { color: "#5eead4", bg: "rgba(94,234,212,0.18)"  },
    "Neutral":   { color: "#cbd5e1", bg: "rgba(203,213,225,0.18)" },
    "Pronated":  { color: "#fda4af", bg: "rgba(253,164,175,0.18)" },
    "Pause":     { color: "#34d399", bg: "rgba(52,211,153,0.18)"  },
    "Tempo":     { color: "#6366f1", bg: "rgba(99,102,241,0.18)"  },
    "Explosive": { color: "#fb7185", bg: "rgba(251,113,133,0.18)" },
    "Isometric": { color: "#94a3b8", bg: "rgba(148,163,184,0.18)" },
    "1S":        { color: "#38bdf8", bg: "rgba(56,189,248,0.18)"  },
    "2S":        { color: "#38bdf8", bg: "rgba(56,189,248,0.18)"  },
    "3S":        { color: "#38bdf8", bg: "rgba(56,189,248,0.18)"  },
    "4S":        { color: "#38bdf8", bg: "rgba(56,189,248,0.18)"  },
    "5S":        { color: "#38bdf8", bg: "rgba(56,189,248,0.18)"  },
  };
  function tagColor(tag) { return TAG_COLORS[tag] || { color: "#94a3b8", bg: "rgba(148,163,184,0.18)" }; }

  function groupForTag(tag) {
    return EXERCISE_MODIFIERS.find((g) => g.tags.includes(tag)) || null;
  }

  // ── Finishers (burnout / dropset) ──
  // Burnout = 1 slot, Dropset = 2 slots. Each slot is a "drop-to" percentage of
  // the exercise's prescribed weight; the athlete logs the reps they hit.
  const FINISHER_PCTS = ["25", "50", "75"];
  function finisherDropWeight(prescribedWeight, pct) {
    const base = weightToLb(prescribedWeight); // "BAR" → 45
    if (!isFinite(base)) return null; // BW or unset — no computed number
    return Math.round((base * (parseInt(pct, 10) / 100)));
  }
  function finisherSummary(ex) {
    const parts = [];
    if (ex.burnout?.pct) parts.push(`🔥${ex.burnout.pct}%`);
    if (ex.dropset?.pcts?.length) parts.push(`⬇${ex.dropset.pcts.join("→")}%`);
    return parts.join("  ");
  }
  // ── Pyramid sets ──
  // Weight climbs each set by a chosen percent, compounding off the previous
  // set's number and rounded to the nearest 5 lb plate. Reps can optionally
  // step down per set (classic 12/10/8). Stored as
  // ex.pyramid = { pct: "10", repDrop: 0 }. Weight ladder starts at
  // ex.currentWeight; BW lifts have no ladder.
  const PYRAMID_PCTS = ["5", "7.5", "10", "12.5", "15"];
  function pyramidActive(ex) {
    return !!(ex && ex.kind !== "mobility" && ex.pyramid && parseFloat(ex.pyramid.pct) > 0);
  }
  function roundPlate5(v) { return Math.max(5, Math.round(v / 5) * 5); }
  function pyramidWeights(ex, numSets) {
    if (!pyramidActive(ex) || !numSets) return null;
    let cur = parseFloat(ex.currentWeight);
    if (!isFinite(cur) || cur <= 0) return null;
    const p = parseFloat(ex.pyramid.pct) / 100;
    const out = [cur];
    for (let i = 1; i < numSets; i++) { cur = roundPlate5(cur * (1 + p)); out.push(cur); }
    return out;
  }
  function pyramidReps(ex, numSets) {
    const base = parseInt(ex.currentReps, 10);
    if (!isFinite(base) || !numSets) return null;
    const drop = parseInt(ex.pyramid?.repDrop, 10) || 0;
    return Array.from({ length: numSets }, (_, i) => Math.max(1, base - drop * i));
  }

  // ── Warm-up sets (optional, up to 3) ──
  // Coach-prescribed explicit weight × reps, done before the working sets and
  // shown as W1/W2/W3 on the athlete card. Stored as ex.warmups = [{weight,reps}].
  function warmupSummary(ex) {
    if (!ex.warmups?.length) return "";
    const s = usesDumbbellPair(ex) ? "s" : ""; // DB pair reads plural ("45s")
    return "W " + ex.warmups
      .map((w) => (w.weight ? (w.weight === "BW" ? "BW" : w.weight === "BAR" ? "BAR" : w.weight + s) : "?"))
      .join("·");
  }

  // Modifier tags sorted by category order (then tag order within a category),
  // so chips + the exercise name read consistently regardless of click order.
  function orderedModifiers(ex) {
    return [...(ex.modifiers || [])].sort((a, b) => {
      const ga = EXERCISE_MODIFIERS.findIndex((g) => g.tags.includes(a));
      const gb = EXERCISE_MODIFIERS.findIndex((g) => g.tags.includes(b));
      if (ga !== gb) return ga - gb;
      const g = EXERCISE_MODIFIERS[ga];
      return g ? g.tags.indexOf(a) - g.tags.indexOf(b) : 0;
    });
  }

  // ── Effort / intensity (coach-set) ──
  // A small "heat ramp" cue: how hard the coach wants this exercise pushed.
  // Light→yellow, Moderate→orange, Hard→red. Stored as ex.effort. Shown as a
  // left-anchored warm gradient on the card + a flame/label tag.
  const EFFORT_LEVELS = {
    light:    { label: "Light",    rgb: "234,179,8",  flames: "🔥" },
    moderate: { label: "Moderate", rgb: "249,115,22", flames: "🔥🔥" },
    hard:     { label: "Hard",     rgb: "239,68,68",  flames: "🔥🔥🔥" },
    max:      { label: "Max",      rgb: "185,28,28",  flames: "🔥🔥🔥🔥" },
  };
  function effortLevel(ex) { return ex && ex.effort ? EFFORT_LEVELS[ex.effort] : null; }
  // Layer the warm gradient onto a card wrapper (coach row or athlete card).
  function applyEffortWrapper(wrapper, ex) {
    // Intensity doesn't apply to mobility/stretching — never tint those cards.
    const m = ex?.kind === "mobility" ? null : effortLevel(ex);
    wrapper.classList.toggle("has-effort", !!m);
    if (m) wrapper.style.setProperty("--effort-rgb", m.rgb);
    else wrapper.style.removeProperty("--effort-rgb");
  }

  // -------- Auto-progression (📈, double progression) --------
  // Coach tags an exercise with a rep ceiling + weight increment. The written
  // reps are the floor. When the athlete locks in EVERY prescribed set at
  // ≥ the ceiling reps and ≥ the effective weight, the next week's matching
  // exercise (by name) shows +increment. Misses hold steady. Program data is
  // never mutated — the effective target is computed from weeks + logs.
  // Ceiling sentinel for bodyweight rep ladders with no cap ("∞").
  const PROG_NO_CAP = 999;

  function progressionRule(ex) {
    const p = ex && ex.progression;
    if (!p || !p.ceil) return null;
    const floor = parseInt(ex.currentReps, 10);
    if (!floor) return null; // needs a rep floor
    const ceil = parseInt(p.ceil, 10);
    if (!ceil || ceil <= floor) return null;
    // Bodyweight: rep ladder. Without an increment it holds at the cap forever.
    // With an increment (and a real cap) it *graduates*: at the cap it starts
    // adding weight and reps reset, then climbs as a normal double-progression.
    if (ex.currentWeight === "BW") {
      const bwInc = parseFloat(p.inc);
      if (bwInc && ceil !== PROG_NO_CAP) {
        const bwReset = parseInt(p.reset, 10);
        return { floor, ceil, inc: bwInc, reset: bwReset >= 1 && bwReset < ceil ? bwReset : floor, bw: true, graduate: true };
      }
      return { floor, ceil, inc: 0, bw: true };
    }
    const base = parseFloat(ex.currentWeight);
    if (!isFinite(base)) return null;
    // Reps-only (weighted): the weight stays as written — reps climb to the
    // ceiling and hold there. Same ladder as bodyweight, but with a bar.
    if (p.repsOnly) return { floor, ceil, inc: 0, repsOnly: true };
    const inc = parseFloat(p.inc);
    if (!inc) return null; // weighted needs a base + increment
    // Optional custom rep target after a weight jump ("sometimes the reps
    // need to drop when going up in weight") — defaults to the floor.
    const reset = parseInt(p.reset, 10);
    return { floor, ceil, inc, reset: reset >= 1 && reset < ceil ? reset : floor };
  }

  // The athlete's most recent locked log for this exercise copy, evaluated at
  // that week's effective weight: returns the WORST set's reps when every
  // prescribed set was done at ≥ the effective weight, else null (no full
  // locked log at weight = hold, same as a miss).
  function progressionMinReps(exCopy, effWeight, logsMap) {
    const arr = logsMap?.[exCopy.id];
    if (!Array.isArray(arr) || !arr.length) return null;
    const entry = [...arr].sort((a, b) => String(b.date).localeCompare(String(a.date)))
      .find((l) => l.locked === true && (l.skipped || (Array.isArray(l.sets) && l.sets.length)));
    if (!entry || entry.skipped) return null; // whole-exercise skip = miss, targets hold
    const need = parseInt(exCopy.sets, 10) || 0;
    if (!need || entry.sets.length < need) return null;
    let min = Infinity;
    for (const s of entry.sets.slice(0, need)) {
      if (s.skipped) return null; // skipped set = miss, targets hold
      if ((parseFloat(s.weight) || 0) < effWeight - 0.01) return null;
      min = Math.min(min, parseInt(s.reps, 10) || 0);
    }
    return min;
  }

  // Walk this exercise's copies (matched by name) in program order up to the
  // given instance, chaining BOTH legs of double progression:
  //   - reps climb: hit every set at ≥ the current rep target → next target =
  //     worst set + 1 (capped at the ceiling);
  //   - weight jump: every set at ≥ the ceiling → +inc lb, reps reset to floor;
  //   - miss (or no locked log) → hold everything.
  // A hand-edited written weight (different from the previous copy's) re-bases
  // the chain, so the coach can deload / jump mid-program by typing a number.
  // Returns { weight, reps, earned, floor, ceil, inc } or null when no rule.
  function effectiveProgression(weeks, ex, logsMap) {
    const rule = progressionRule(ex);
    if (!rule) return null;
    const name = String(ex.name || "").trim().toLowerCase();
    if (!name) return null;
    if (rule.bw) {
      // Bodyweight rep ladder: worst set + 1 on a hit. Without graduation it
      // holds at the cap (no weight to jump to). With graduation, hitting the
      // cap on every set adds `inc` lb of load and resets reps, after which the
      // ladder climbs weight like the weighted chain below — while every week's
      // written weight stays "BW". A hand-edited written REPS value re-bases the
      // rep floor (only before graduating), mirroring the weighted chain's
      // re-base on a written-weight edit.
      let reps = rule.floor, weight = 0, earned = 0, prevFloor = null;
      for (const w of weeks || []) {
        for (const d of w.days || []) {
          for (const e of d.exercises || []) {
            if (String(e.name || "").trim().toLowerCase() !== name) continue;
            if (e.currentWeight !== "BW") continue; // ladder only chains BW copies
            const f = parseInt(e.currentReps, 10);
            if (!f) continue;
            if (weight === 0 && (prevFloor === null || f !== prevFloor)) reps = f;
            prevFloor = f;
            if (e.id === ex.id) {
              return weight > 0
                ? { weight: Math.round(weight * 100) / 100, reps, earned, ...rule, bw: false }
                : { weight: null, reps, earned, ...rule };
            }
            const min = progressionMinReps(e, weight, logsMap);
            if (min == null || min < reps) continue; // miss / no log → hold
            if (rule.graduate && min >= rule.ceil) { weight += rule.inc; reps = rule.reset; earned += 1; }
            else reps = Math.min(min + 1, rule.ceil);
          }
        }
      }
      return null;
    }
    let eff = null, reps = rule.floor, earned = 0, prevWritten = null;
    for (const w of weeks || []) {
      for (const d of w.days || []) {
        for (const e of d.exercises || []) {
          if (String(e.name || "").trim().toLowerCase() !== name) continue;
          const written = parseFloat(e.currentWeight);
          if (!isFinite(written)) continue; // skip BW/blank copies
          if (prevWritten === null || written !== prevWritten) { eff = written; reps = rule.floor; earned = 0; }
          prevWritten = written;
          if (e.id === ex.id) return { weight: Math.round(eff * 100) / 100, reps, earned, ...rule };
          const min = progressionMinReps(e, eff, logsMap);
          if (min == null || min < reps) continue; // miss / no log → hold
          // Reps-only rules never jump weight — the ladder just tops out.
          if (min >= rule.ceil && !rule.repsOnly) { eff += rule.inc; reps = rule.reset; earned += 1; }
          else reps = Math.min(min + 1, rule.ceil);
        }
      }
    }
    return null; // instance not found in the given weeks
  }

  function openEffortPicker(ex, anchorBtn, onChange) {
    document.querySelector(".effort-pop")?.remove();
    const pop = document.createElement("div");
    pop.className = "grid-picker-pop effort-pop";
    pop.style.cssText = "position:fixed;z-index:9999;visibility:hidden";
    const opts = [
      { key: null, label: "None", flames: "—", rgb: null },
      { key: "light", ...EFFORT_LEVELS.light },
      { key: "moderate", ...EFFORT_LEVELS.moderate },
      { key: "hard", ...EFFORT_LEVELS.hard },
      { key: "max", ...EFFORT_LEVELS.max },
    ];
    const current = ex.effort || null;
    opts.forEach((o) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "effort-opt" + (current === o.key ? " on" : "");
      if (o.rgb) b.style.setProperty("--effort-rgb", o.rgb);
      b.innerHTML = `<span class="effort-opt-flames">${o.flames}</span><span class="effort-opt-lbl">${escapeHtml(o.label)}</span>`;
      b.addEventListener("click", () => {
        if (o.key) ex.effort = o.key; else delete ex.effort;
        saveTrainer();
        onChange();
        pop.remove();
      });
      pop.appendChild(b);
    });
    document.body.appendChild(pop);
    requestAnimationFrame(() => _positionPop(pop, anchorBtn));
    _attachOutsideClose(pop, anchorBtn);
  }

  const PROG_CEIL_VALUES = [6, 8, 10, 12, 15, 18, 20];
  const PROG_REPS_ONLY = 0; // "Then add" sentinel: no weight leg, reps climb and hold at the ceiling
  const PROG_BW_CEIL_VALUES = [10, 12, 15, 20, 25, 30, 40, 50];
  const PROG_INC_VALUES = [2.5, 5, 10];

  function openProgressionPicker(ex, anchorBtn, onChange) {
    document.querySelector(".prog-pop")?.remove();
    const pop = document.createElement("div");
    pop.className = "grid-picker-pop prog-pop";
    pop.style.cssText = "position:fixed;z-index:9999;visibility:hidden";

    const floor = parseInt(ex.currentReps, 10) || 0;
    const isBW = ex.currentWeight === "BW";
    const render = () => {
      pop.innerHTML = "";
      const p = ex.progression || {};
      const head = document.createElement("div");
      head.className = "prog-pop-head";
      head.textContent = isBW ? "📈 Rep ladder (bodyweight)" : "📈 Auto-progression";
      pop.appendChild(head);

      const hint = document.createElement("p");
      hint.className = "prog-pop-hint";
      hint.textContent = !floor
        ? "Set prescribed reps first. They become the rep floor."
        : isBW
          ? (p.inc && parseInt(p.ceil, 10) !== PROG_NO_CAP
              ? `Reps climb from ${floor} to ${p.ceil || "the cap"}. When every set hits the cap, next block adds ${p.inc} lb and reps reset to ${p.reset || floor} — bodyweight graduates to weighted, then keeps climbing.`
              : `Reps climb from ${floor} each week they hit the target (worst set + 1), and hold at the cap. No weight is added — stays bodyweight.`)
          : p.repsOnly
            ? `Reps climb from ${floor} each week they hit the target (worst set + 1), and hold at the ceiling. The weight stays as written.`
            : `Reps climb from ${floor}. When every set hits the ceiling, next week adds weight and reps reset to ${floor}. Misses hold steady.`;
      pop.appendChild(hint);

      const section = (label, values, cur, fmt, onPick) => {
        const lbl = document.createElement("div");
        lbl.className = "prog-pop-lbl";
        lbl.textContent = label;
        pop.appendChild(lbl);
        const row = document.createElement("div");
        row.className = "prog-pop-row";
        values.forEach((v) => {
          const b = document.createElement("button");
          b.type = "button";
          b.className = "prog-opt" + (cur === v ? " on" : "");
          b.textContent = fmt(v);
          b.disabled = !floor;
          b.addEventListener("click", () => onPick(v));
          row.appendChild(b);
        });
        pop.appendChild(row);
      };

      if (isBW) {
        // Rep cap. PROG_NO_CAP = climb forever ("∞"); a finite cap can graduate.
        section("Rep cap", [...PROG_BW_CEIL_VALUES.filter((v) => v > floor), PROG_NO_CAP],
          parseInt(p.ceil, 10) || null,
          (v) => (v === PROG_NO_CAP ? "∞ no cap" : `${floor || "?"}→${v}`),
          (v) => {
            // ∞ can't graduate; a finite cap keeps any chosen weight increment.
            ex.progression = v === PROG_NO_CAP
              ? { ceil: v }
              : { ceil: v, ...(p.inc ? { inc: p.inc, ...(p.reset ? { reset: p.reset } : {}) } : {}) };
            saveTrainer(); onChange(); render();
          });
        // "Then add weight" — off = bodyweight forever; a weight = graduate at the
        // cap. Picking a weight with no finite cap yet defaults one from the list.
        section("Then add weight", [PROG_REPS_ONLY, ...PROG_INC_VALUES],
          p.inc && parseInt(p.ceil, 10) !== PROG_NO_CAP ? parseFloat(p.inc) : PROG_REPS_ONLY,
          (v) => (v === PROG_REPS_ONLY ? "Stay BW" : `+${v} lb`),
          (v) => {
            let ceil = parseInt(p.ceil, 10);
            if (!ceil || ceil === PROG_NO_CAP) ceil = PROG_BW_CEIL_VALUES.find((c) => c > floor) || floor + 7;
            ex.progression = v === PROG_REPS_ONLY
              ? { ceil }
              : { ceil, inc: v, ...(p.reset && p.reset < ceil ? { reset: p.reset } : {}) };
            saveTrainer(); onChange(); render();
          });
        // Optional: reps after the weight jump (defaults to the floor). Only
        // meaningful once graduation is on.
        const bwRLbl = document.createElement("div");
        bwRLbl.className = "prog-pop-lbl";
        bwRLbl.textContent = "Reps after the jump (optional)";
        pop.appendChild(bwRLbl);
        const bwRInp = document.createElement("input");
        bwRInp.type = "number";
        bwRInp.min = "1";
        bwRInp.className = "prog-reset-input";
        bwRInp.placeholder = floor ? String(floor) : "—";
        bwRInp.value = p.reset || "";
        bwRInp.disabled = !floor || !p.inc || parseInt(p.ceil, 10) === PROG_NO_CAP;
        bwRInp.addEventListener("click", (e) => e.stopPropagation());
        bwRInp.addEventListener("change", () => {
          if (!ex.progression) return;
          const v = parseInt(bwRInp.value, 10);
          if (v >= 1 && v < (parseInt(ex.progression.ceil, 10) || Infinity)) ex.progression.reset = v;
          else { delete ex.progression.reset; bwRInp.value = ""; }
          saveTrainer(); onChange();
        });
        pop.appendChild(bwRInp);
      } else {
        section("Rep ceiling", PROG_CEIL_VALUES.filter((v) => v > floor), parseInt(p.ceil, 10) || null,
          (v) => `${floor || "?"}–${v}`,
          (v) => { ex.progression = p.repsOnly ? { ceil: v, repsOnly: true } : { ceil: v, inc: parseFloat(p.inc) || 5 }; saveTrainer(); onChange(); render(); });
        // "Reps only" rides the increment row: same ladder, no weight leg.
        section("Then add", [...PROG_INC_VALUES, PROG_REPS_ONLY], p.repsOnly ? PROG_REPS_ONLY : (parseFloat(p.inc) || null),
          (v) => (v === PROG_REPS_ONLY ? "Reps only" : `+${v} lb`),
          (v) => {
            const ceil = parseInt(p.ceil, 10) || (floor + 4);
            ex.progression = v === PROG_REPS_ONLY ? { ceil, repsOnly: true } : { ceil, inc: v, ...(p.reset ? { reset: p.reset } : {}) };
            saveTrainer(); onChange(); render();
          });

        // Optional: custom rep target after a weight jump (defaults to the
        // floor). Lets a heavier week start lower, e.g. 8–12 then +10 → 6.
        const rLbl = document.createElement("div");
        rLbl.className = "prog-pop-lbl";
        rLbl.textContent = "Reps after the jump (optional)";
        pop.appendChild(rLbl);
        const rInp = document.createElement("input");
        rInp.type = "number";
        rInp.min = "1";
        rInp.className = "prog-reset-input";
        rInp.placeholder = floor ? String(floor) : "—";
        rInp.value = p.reset || "";
        rInp.disabled = !floor || !p.ceil || !!p.repsOnly; // no jump → no reset reps
        rInp.addEventListener("click", (e) => e.stopPropagation());
        rInp.addEventListener("change", () => {
          if (!ex.progression) return;
          const v = parseInt(rInp.value, 10);
          if (v >= 1 && v < (parseInt(ex.progression.ceil, 10) || Infinity)) ex.progression.reset = v;
          else { delete ex.progression.reset; rInp.value = ""; }
          saveTrainer(); onChange();
        });
        pop.appendChild(rInp);
      }

      const off = document.createElement("button");
      off.type = "button";
      off.className = "prog-opt prog-opt-off" + (!ex.progression ? " on" : "");
      off.textContent = "No auto-progression";
      off.addEventListener("click", () => { delete ex.progression; saveTrainer(); onChange(); render(); });
      pop.appendChild(off);
    };
    render();

    document.body.appendChild(pop);
    requestAnimationFrame(() => _positionPop(pop, anchorBtn));
    _attachOutsideClose(pop, anchorBtn);
  }

  function openPyramidPicker(ex, anchorBtn, onChange) {
    document.querySelector(".pyr-pop")?.remove();
    const pop = document.createElement("div");
    pop.className = "grid-picker-pop prog-pop pyr-pop";
    pop.style.cssText = "position:fixed;z-index:9999;visibility:hidden";

    const saveChange = () => { saveTrainer(); onChange(); render(); };

    function render() {
      pop.innerHTML = "";
      const head = document.createElement("div");
      head.className = "prog-pop-head";
      head.textContent = "🔺 Pyramid sets";
      pop.appendChild(head);

      const hint = document.createElement("p");
      hint.className = "prog-pop-hint";
      hint.textContent = "Weight climbs each set by this percent, compounding off the previous set and rounded to 5 lb plates.";
      pop.appendChild(hint);

      // % per set (10% is the classic; Off clears it)
      const pctRow = document.createElement("div");
      pctRow.className = "finisher-pct-row";
      const offBtn = document.createElement("button");
      offBtn.type = "button";
      offBtn.className = "finisher-pct-btn" + (!ex.pyramid ? " on" : "");
      offBtn.textContent = "Off";
      offBtn.addEventListener("click", () => { delete ex.pyramid; saveChange(); });
      pctRow.appendChild(offBtn);
      PYRAMID_PCTS.forEach((p) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "finisher-pct-btn" + (ex.pyramid?.pct === p ? " on" : "");
        b.textContent = "+" + p + "%";
        b.addEventListener("click", () => {
          ex.pyramid = { pct: p, repDrop: ex.pyramid?.repDrop || 0 };
          saveChange();
        });
        pctRow.appendChild(b);
      });
      pop.appendChild(pctRow);

      if (ex.pyramid) {
        const dropLbl = document.createElement("div");
        dropLbl.className = "finisher-slot-lbl";
        dropLbl.textContent = "Reps each set";
        pop.appendChild(dropLbl);
        const dropRow = document.createElement("div");
        dropRow.className = "finisher-pct-row";
        [[0, "Same"], [1, "−1"], [2, "−2"], [3, "−3"]].forEach(([d, lbl]) => {
          const b = document.createElement("button");
          b.type = "button";
          b.className = "finisher-pct-btn" + ((parseInt(ex.pyramid.repDrop, 10) || 0) === d ? " on" : "");
          b.textContent = lbl;
          b.addEventListener("click", () => { ex.pyramid.repDrop = d; saveChange(); });
          dropRow.appendChild(b);
        });
        pop.appendChild(dropRow);

        // Live preview of the ladder from the current sets/weight/reps
        const n = parseInt(ex.sets, 10) || 0;
        const w = pyramidWeights(ex, n);
        const preview = document.createElement("p");
        preview.className = "prog-pop-hint pyr-preview";
        if (!w) {
          preview.textContent = ex.currentWeight === "BW"
            ? "Bodyweight lifts have no weight ladder. Set a weight first."
            : "Set a starting weight and sets to see the ladder.";
        } else {
          const r = pyramidReps(ex, n);
          preview.textContent = w.map((wt, i) => `${wt}${r ? "×" + r[i] : ""}`).join(" · ");
        }
        pop.appendChild(preview);
      }
    }
    render();
    document.body.appendChild(pop);
    requestAnimationFrame(() => _positionPop(pop, anchorBtn));
    _attachOutsideClose(pop, anchorBtn);
  }

  function openFinisherPicker(ex, anchorBtn, onChange) {
    document.querySelector(".finisher-pop")?.remove();
    const pop = document.createElement("div");
    pop.className = "grid-picker-pop finisher-pop";
    pop.style.cssText = "position:fixed;z-index:9999;visibility:hidden";

    const saveChange = () => { saveTrainer(); onChange(); render(); };

    function pctRow(currentPct, onPick) {
      const row = document.createElement("div");
      row.className = "finisher-pct-row";
      FINISHER_PCTS.forEach((p) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "finisher-pct-btn" + (currentPct === p ? " on" : "");
        b.textContent = p + "%";
        b.addEventListener("click", () => onPick(p));
        row.appendChild(b);
      });
      return row;
    }

    function section(title, hint, enabled, onToggle, bodyBuilder) {
      const sec = document.createElement("div");
      sec.className = "finisher-sec";
      const head = document.createElement("button");
      head.type = "button";
      head.className = "finisher-toggle" + (enabled ? " on" : "");
      head.innerHTML = `<span class="finisher-toggle-lbl">${title}<small>${hint}</small></span><span class="finisher-switch">${enabled ? "ON" : "OFF"}</span>`;
      head.addEventListener("click", onToggle);
      sec.appendChild(head);
      if (enabled) sec.appendChild(bodyBuilder());
      return sec;
    }

    function render() {
      pop.innerHTML = "";
      pop.appendChild(section("🔥 Burnout", "1 set to failure", !!ex.burnout,
        () => { ex.burnout = ex.burnout ? null : { pct: "50" }; saveChange(); },
        () => {
          const body = document.createElement("div");
          body.className = "finisher-body";
          body.appendChild(pctRow(ex.burnout.pct, (p) => { ex.burnout.pct = p; saveChange(); }));
          return body;
        }));
      pop.appendChild(section("⬇ Dropset", "2 drops", !!ex.dropset,
        () => { ex.dropset = ex.dropset ? null : { pcts: ["75", "50"] }; saveChange(); },
        () => {
          const body = document.createElement("div");
          body.className = "finisher-body";
          [0, 1].forEach((i) => {
            const lbl = document.createElement("div");
            lbl.className = "finisher-slot-lbl";
            lbl.textContent = `Drop ${i + 1}`;
            body.appendChild(lbl);
            body.appendChild(pctRow(ex.dropset.pcts[i], (p) => { ex.dropset.pcts[i] = p; saveChange(); }));
          });
          return body;
        }));
      requestAnimationFrame(() => _positionPop(pop, anchorBtn));
    }

    document.body.appendChild(pop);
    render();
    _attachOutsideClose(pop, anchorBtn);
  }

  // Warm-up editor: 0/1/2/3 slots, each an explicit weight × reps picker. Its own
  // popover class (not .grid-picker-pop) so the nested weight/reps pickers don't
  // wipe it; the outside-close ignores clicks landing inside those pickers.
  function openWarmupPicker(ex, anchorBtn, onChange) {
    document.querySelector(".warmup-pop")?.remove();
    const pop = document.createElement("div");
    pop.className = "warmup-pop";
    pop.style.cssText = "position:fixed;z-index:9999;visibility:hidden";

    const save = () => { saveTrainer(); onChange(); };
    const wtLabel = (v) => exWeightLabel(ex, v) || "Wt"; // "50s" on DB pairs

    function setCount(n) {
      if (!ex.warmups) ex.warmups = [];
      if (n === 0) ex.warmups = [];
      else {
        while (ex.warmups.length < n) ex.warmups.push({ weight: "", reps: "" });
        ex.warmups.length = n;
      }
      save();
      render();
    }

    function render() {
      pop.innerHTML = "";
      const count = ex.warmups?.length || 0;

      const head = document.createElement("div");
      head.className = "warmup-head";
      head.textContent = "Warm-up sets";
      pop.appendChild(head);

      const seg = document.createElement("div");
      seg.className = "warmup-seg";
      [["None", 0], ["1", 1], ["2", 2], ["3", 3]].forEach(([lbl, n]) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "warmup-seg-btn" + (count === n ? " on" : "");
        b.textContent = lbl;
        b.addEventListener("click", () => setCount(n));
        seg.appendChild(b);
      });
      pop.appendChild(seg);

      (ex.warmups || []).forEach((w, i) => {
        const row = document.createElement("div");
        row.className = "warmup-slot";

        const lbl = document.createElement("span");
        lbl.className = "warmup-slot-lbl";
        lbl.textContent = `W${i + 1}`;
        row.appendChild(lbl);

        const wBtn = document.createElement("button");
        wBtn.type = "button";
        wBtn.className = "picker-btn picker-btn-sm" + (w.weight ? "" : " empty");
        wBtn.textContent = wtLabel(w.weight);
        wBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          openWeightPicker(w.weight || "BW", (val) => {
            w.weight = val; save();
            wBtn.textContent = wtLabel(val); wBtn.classList.toggle("empty", !val);
          }, wBtn);
        });
        row.appendChild(wBtn);

        const x = document.createElement("span");
        x.className = "warmup-x"; x.textContent = "×";
        row.appendChild(x);

        const rBtn = document.createElement("button");
        rBtn.type = "button";
        rBtn.className = "picker-btn picker-btn-sm" + (w.reps ? "" : " empty");
        rBtn.textContent = w.reps || "Reps";
        rBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          openGridPicker("Reps", REPS_VALUES, w.reps || "8", (val) => {
            w.reps = val; save();
            rBtn.textContent = val; rBtn.classList.remove("empty");
          }, rBtn, 6);
        });
        row.appendChild(rBtn);

        pop.appendChild(row);
      });

      requestAnimationFrame(() => _positionPop(pop, anchorBtn));
    }

    document.body.appendChild(pop);
    render();

    const handler = (e) => {
      if (pop.contains(e.target) || e.target === anchorBtn) return;
      if (e.target.closest && e.target.closest(".grid-picker-pop")) return; // nested picker
      pop.remove();
      document.removeEventListener("mousedown", handler, true);
    };
    document.addEventListener("mousedown", handler, true);
  }

  function renderModChips(container, ex, position, openPicker) {
    // position: "before" = Unilateral+Equipment+Position  "after" = Style+Hold
    // Chips are display-only — clicking one opens the tag picker (if provided)
    // where it can be unclicked. Tags are never removed by tapping the chip.
    container.innerHTML = "";
    const groups = position === "before"
      ? EXERCISE_MODIFIERS.filter((g) => g.group !== "Style" && g.group !== "Hold")
      : EXERCISE_MODIFIERS.filter((g) => g.group === "Style" || g.group === "Hold");
    orderedModifiers(ex).forEach((tag) => {
      const g = groupForTag(tag);
      if (!g || !groups.includes(g)) return;
      const { color, bg } = tagColor(tag);
      const chip = document.createElement("span");
      chip.className = "mod-chip";
      chip.textContent = tag;
      chip.style.setProperty("--mc", color);
      chip.style.setProperty("--mb", bg);
      if (openPicker) {
        chip.title = `${g.group} · open tags to edit`;
        chip.addEventListener("click", (e) => { e.stopPropagation(); openPicker(); });
      } else {
        chip.title = g.group;
      }
      container.appendChild(chip);
    });
  }

  function openModPicker(ex, anchorBtn, chipsBefore, chipsAfter, onTagsChange) {
    // Exercises saved before the exclusivity rule (or synced from an older
    // client) can still hold both — clean them up as the coach opens the picker
    // so the buttons below never render in a contradictory state.
    if (dropConflictingTags(ex)) { saveTrainer(); onTagsChange?.(); }
    document.querySelector(".mod-picker-pop")?.remove();
    const pop = document.createElement("div");
    pop.className = "mod-picker-pop";

    const clearHoldTag = () => {
      ex.modifiers = (ex.modifiers || []).filter((m) => !HOLD_TAGS.includes(m));
      pop.querySelectorAll('[data-group="Hold"] .mod-picker-btn.on').forEach((b) => {
        b.classList.remove("on");
        b.style.removeProperty("--mc"); b.style.removeProperty("--mb");
      });
    };
    const setHoldRowOpen = (open) => {
      const holdGrp = pop.querySelector('[data-group="Hold"]');
      if (holdGrp) holdGrp.classList.toggle("hidden", !open);
    };

    EXERCISE_MODIFIERS.forEach(({ group, tags, multi }) => {
      const grp = document.createElement("div");
      grp.className = "mod-picker-grp";
      grp.dataset.group = group;
      const lbl = document.createElement("div");
      lbl.className = "mod-picker-lbl";
      lbl.textContent = group === "Hold" ? "Hold (seconds) · Isometric only" : group;
      grp.appendChild(lbl);
      const row = document.createElement("div");
      row.className = "mod-picker-row";
      tags.forEach((tag) => {
        const { color, bg } = tagColor(tag);
        const btn = document.createElement("button");
        btn.className = "mod-picker-btn" + ((ex.modifiers || []).includes(tag) ? " on" : "");
        btn.textContent = tag;
        if ((ex.modifiers || []).includes(tag)) { btn.style.setProperty("--mc", color); btn.style.setProperty("--mb", bg); }
        btn.addEventListener("click", (e) => {
          e.stopPropagation();
          if (!ex.modifiers) ex.modifiers = [];
          if (ex.modifiers.includes(tag)) {
            // deselect
            ex.modifiers = ex.modifiers.filter((m) => m !== tag);
            btn.classList.remove("on");
            btn.style.removeProperty("--mc"); btn.style.removeProperty("--mb");
            if (tag === "Isometric") clearHoldTag();
          } else {
            // Contradictory tags come off first, multi group or not — picking
            // DBs clears DB and vice versa.
            conflictingTags(tag).forEach((t) => {
              if (!ex.modifiers.includes(t)) return;
              ex.modifiers = ex.modifiers.filter((m) => m !== t);
              const sibling = pop.querySelector(`[data-tag="${t}"]`);
              if (sibling) {
                sibling.classList.remove("on");
                sibling.style.removeProperty("--mc"); sibling.style.removeProperty("--mb");
              }
            });
            // single-select groups: deselect any other tag in this group first.
            // multi groups (e.g. Equipment) let tags stack — Cable + Rope, etc.
            if (!multi) {
              tags.forEach((t) => {
                if (t !== tag && ex.modifiers.includes(t)) {
                  ex.modifiers = ex.modifiers.filter((m) => m !== t);
                  const sibling = row.querySelector(`[data-tag="${t}"]`);
                  if (sibling) { sibling.classList.remove("on"); sibling.style.removeProperty("--mc"); sibling.style.removeProperty("--mb"); }
                }
              });
            }
            ex.modifiers.push(tag);
            btn.classList.add("on");
            btn.style.setProperty("--mc", color); btn.style.setProperty("--mb", bg);
          }
          if (!ex.modifiers.includes("Isometric")) {
            clearHoldTag();
            setHoldRowOpen(false);
          } else if (tag === "Isometric") {
            setHoldRowOpen(true);
          } else if (!HOLD_TAGS.includes(tag)) {
            setHoldRowOpen(false);
          }
          saveTrainer();
          const reopen = () => openModPicker(ex, anchorBtn, chipsBefore, chipsAfter, onTagsChange);
          renderModChips(chipsBefore, ex, "before", reopen);
          renderModChips(chipsAfter, ex, "after", reopen);
          onTagsChange?.();
        });
        btn.dataset.tag = tag;
        row.appendChild(btn);
      });
      grp.appendChild(row);
      pop.appendChild(grp);
    });

    setHoldRowOpen(false);
    document.body.appendChild(pop);
    const rect = anchorBtn.getBoundingClientRect();
    const pw = 260;
    const ph = pop.getBoundingClientRect().height;
    let left = rect.left;
    if (left + pw > window.innerWidth - 8) left = window.innerWidth - pw - 8;
    const spaceBelow = window.innerHeight - rect.bottom - 8;
    const top = spaceBelow >= ph ? rect.bottom + 6 : Math.max(8, rect.top - ph - 6);
    pop.style.position = "fixed";
    pop.style.top  = top + "px";
    pop.style.left = Math.max(8, left) + "px";

    setTimeout(() => {
      document.addEventListener("click", function close(e) {
        if (!pop.contains(e.target)) { pop.remove(); document.removeEventListener("click", close); }
      });
    }, 30);
  }

  function getYouTubeId(url) {
    if (!url) return null;
    const s = String(url).trim();
    const m = s.match(/(?:youtube\.com\/(?:watch\?v=|embed\/|shorts\/|v\/)|youtu\.be\/)([A-Za-z0-9_-]{11})/);
    if (m) return m[1];
    if (/^[A-Za-z0-9_-]{11}$/.test(s)) return s; // bare ID
    return null;
  }

  // -------- State --------
  const state = {
    trainerData: loadJSON(KEY_TRAINER, DEFAULT_TRAINER),
    clientData:  loadJSON(KEY_CLIENT,  DEFAULT_CLIENT),
    mode: null,
    currentClientId: null,
    currentTab: "profile",
    coachCal: { year: 0, month: 0 },   // 0-indexed month
    athleteCal: { year: 0, month: 0 },
  };

  // ensure existing clients have new fields
  let _trainerDataDirty = false;
  // Initialize the reusable workout-template library (local-only, no cloud sync in v1).
  if (!Array.isArray(state.trainerData.workoutTemplates)) {
    state.trainerData.workoutTemplates = [];
  }
  if (!Array.isArray(state.trainerData.openSlots)) {
    state.trainerData.openSlots = [];
  }
  if (!Array.isArray(state.trainerData.programTemplates)) {
    state.trainerData.programTemplates = [];
  }
  // Coach-side list of exercise names hidden from the library sidebar.
  if (!Array.isArray(state.trainerData.hiddenExercises)) {
    state.trainerData.hiddenExercises = [];
  }
  // Coach-added custom exercises ({ name, cat }) shown alongside the built-in library.
  if (!Array.isArray(state.trainerData.customExercises)) {
    state.trainerData.customExercises = [];
  }
  state.trainerData.clients.forEach((c) => {
    if (!c.schedule) c.schedule = {};
    if (!c.coachPRs) c.coachPRs = [];
    if (!Array.isArray(c.oneOffDays)) c.oneOffDays = [];
    if (!Array.isArray(c.archivedPrograms)) c.archivedPrograms = [];
    ensureSessionBank(c);
    if (!c.inviteCode) { c.inviteCode = makeInviteCode(); _trainerDataDirty = true; }
    // Migrate weekly diet targets → one standing nutrition plan: seed from the
    // last week that had targets filled in, so nobody starts blank.
    if (!c.nutrition) {
      const src = [...(c.weeks || [])].reverse().find((w) => w.diet && (w.diet.calories || w.diet.protein));
      c.nutrition = {
        current: src ? {
          calories: String(src.diet.calories || ""),
          protein: String(src.diet.protein || ""),
          carbs: "", fat: "",
          notes: src.diet.notes || "",
          effectiveFrom: todayISO(),
        } : null,
        history: [],
      };
      _trainerDataDirty = true;
    }
  });
  // Backfill a stable coachId — used as the cloud "coaches" row key.
  if (!state.trainerData.coachId && state.trainerData.trainer) {
    state.trainerData.coachId = uid();
    _trainerDataDirty = true;
  }
  // Auto-redeem watermark: booked sessions ending before this moment are
  // never auto-charged, so enabling the feature can't bill old history.
  if (!state.trainerData.autoRedeemSince) {
    state.trainerData.autoRedeemSince = Date.now();
    _trainerDataDirty = true;
  }
  // One-time DB → DBs tag split (2026-07-17): the old single DB tag meant a
  // PAIR of dumbbells unless 1A/1L was present. Rewrite those to the explicit
  // DBs tag so a bare DB can now mean one dumbbell. Runs once per device —
  // after the split, a bare DB tag is a deliberate single and must stay.
  const KEY_DBTAG_SPLIT = "trainerpro_dbtag_split_v1";
  if (!localStorage.getItem(KEY_DBTAG_SPLIT)) {
    let _clientDataDirty = false;
    const migEx = (exs, markClient) => (exs || []).forEach((ex) => {
      const m = ex && ex.modifiers;
      if (Array.isArray(m) && m.includes("DB") && !m.includes("DBs") && !m.includes("1A") && !m.includes("1L")) {
        ex.modifiers = m.map((t) => (t === "DB" ? "DBs" : t));
        if (markClient) _clientDataDirty = true; else _trainerDataDirty = true;
      }
    });
    const migWeeks = (weeks, markClient) =>
      (weeks || []).forEach((w) => (w.days || []).forEach((d) => migEx(d.exercises, markClient)));
    const changedClients = [];
    state.trainerData.clients.forEach((c) => {
      const wasDirty = _trainerDataDirty;
      _trainerDataDirty = false;
      migWeeks(c.weeks);
      (c.archivedPrograms || []).forEach((a) => migWeeks(a.weeks));
      if (_trainerDataDirty) changedClients.push(c);
      _trainerDataDirty = _trainerDataDirty || wasDirty;
    });
    (state.trainerData.programTemplates || []).forEach((p) => migWeeks(p.weeks));
    (state.trainerData.workoutTemplates || []).forEach((t) => migEx(t.exercises));
    migWeeks(state.clientData.program?.client?.weeks, true);
    localStorage.setItem(KEY_DBTAG_SPLIT, "1");
    if (_clientDataDirty) localStorage.setItem(KEY_CLIENT, JSON.stringify(state.clientData));
    // Push every migrated athlete so their devices pull the rewritten tags
    // (the debounce gives the auth session time to restore; a failed push
    // self-heals the next time that athlete is edited).
    if (window.Cloud?.enabled) changedClients.forEach((c) =>
      window.Cloud.debounce(`athlete:${c.id}`, () => window.Cloud.upsertAthlete(c, state.trainerData.coachId)));
  }

  if (_trainerDataDirty) saveTrainer();

  // One-time cloud backfill: if this device has local data that predates cloud sync,
  // push everything once so cross-device login works without requiring an edit first.
  const KEY_CLOUD_BACKFILLED = "trainerpro_cloud_backfilled_v1";
  if (
    window.Cloud?.enabled &&
    state.trainerData.trainer &&
    state.trainerData.coachId &&
    !localStorage.getItem(KEY_CLOUD_BACKFILLED)
  ) {
    (async () => {
      await window.Cloud.upsertCoach(state.trainerData.coachId, state.trainerData.trainer.name, state.trainerData.trainer.email || "", state.trainerData.coachAuthId || null);
      for (const c of state.trainerData.clients) {
        await window.Cloud.upsertAthlete(c, state.trainerData.coachId);
      }
      localStorage.setItem(KEY_CLOUD_BACKFILLED, String(Date.now()));
      console.log(`[Cloud] Backfilled coach + ${state.trainerData.clients.length} athletes.`);
    })().catch((e) => console.warn("[Cloud] backfill failed; will retry next boot", e));
  }

  // -------- DOM helpers --------
  const $ = (sel) => document.querySelector(sel);
  const $$ = (sel) => Array.from(document.querySelectorAll(sel));
  function show(el) {
    el.classList.remove("hidden");
    // Screens carry sticky bars offset by --header-h; re-measure whenever one
    // becomes visible (hidden headers measure 0, so boot-time sync can't).
    if (el.classList.contains("screen")) syncHeaderHeights();
  }
  function hide(el) { el.classList.add("hidden"); }

  // Sticky offsets (.coach-nav, #screen-client .tabs, .ex-lib-sidebar) pin at
  // the real rendered header height instead of a hardcoded px guess — see the
  // var(--header-h, …) rules in styles.css. The first-frame measure right
  // after a screen unhides can be a few px off (fonts/layout still settling),
  // so re-measure on the next frame and once more shortly after.
  function syncHeaderHeights() {
    const apply = () => $$(".screen").forEach((s) => {
      const header = s.querySelector(".app-header");
      if (header && header.offsetHeight) s.style.setProperty("--header-h", header.offsetHeight + "px");
    });
    apply();
    requestAnimationFrame(apply);
    setTimeout(apply, 250);
  }

  // ---- Back-button router --------------------------------------------------
  // Makes the phone / browser Back button step back through in-app screens
  // instead of exiting the installed PWA. Drilling into a screen (open a
  // workout, open an athlete, enter preview) calls Nav.push(backFn) which adds
  // one history entry; Back — whether the hardware button or an in-app back
  // button routed through Nav.back() — pops one level and runs that handler.
  // Root screens reset the stack, so Back there exits as usual. `inBack` makes
  // push/reset no-ops while a back handler runs (those handlers call the same
  // navigation functions), keeping history and the stack in sync.
  const Nav = (function () {
    const stack = [];
    let inBack = false;
    function push(backFn) {
      if (inBack || typeof backFn !== "function") return;
      stack.push(backFn);
      try { history.pushState({ sdDepth: stack.length }, ""); } catch (e) {}
    }
    function reset() {
      if (inBack) return;
      stack.length = 0;
      try { history.replaceState({ sdDepth: 0 }, ""); } catch (e) {}
    }
    function back(fallback) {
      if (stack.length) history.back();
      else if (typeof fallback === "function") fallback();
    }
    window.addEventListener("popstate", () => {
      const fn = stack.pop();
      if (!fn) return;
      inBack = true;
      try { fn(); } catch (e) { console.warn("[Nav] back handler failed", e); }
      inBack = false;
    });
    return { push, reset, back };
  })();

  function playLoginFlash() {
    document.body.classList.add("login-success");
    setTimeout(() => document.body.classList.remove("login-success"), 1100);
  }

  function celebrateElement(el, className = "pr-celebrate", durationMs = 900) {
    if (!el) return;
    el.classList.remove(className);
    void el.offsetWidth; // restart animation
    el.classList.add(className);
    setTimeout(() => el.classList.remove(className), durationMs);
  }

  // One-shot celebration when an athlete finishes every exercise in a day:
  // a badge plus a confetti burst that clears itself. Deliberately silent —
  // no audio, since this fires in a gym. Overlay is pointer-events:none so it
  // can never block a tap, and it removes itself rather than needing dismissal.
  function celebrateDayComplete() {
    if (document.querySelector(".day-celebrate")) return; // never stack bursts
    const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)")?.matches;
    const host = document.createElement("div");
    host.className = "day-celebrate";
    host.setAttribute("aria-hidden", "true"); // decorative; the toast carries the message
    const COLORS = ["#22d3ee", "#10b981", "#f59e0b", "#ef4444", "#a78bfa", "#ec4899", "#facc15"];
    let html = `<div class="dc-badge"><span class="dc-icon">🎉</span><span class="dc-text">Day complete!</span></div>`;
    // Reduced-motion still gets the badge, just no falling pieces.
    for (let i = 0; i < (reduce ? 0 : 90); i++) {
      const w = 6 + Math.random() * 6;
      html += `<span class="dc-bit" style="left:${(Math.random() * 100).toFixed(2)}%;`
        + `--dc-c:${COLORS[i % COLORS.length]};`
        + `--dc-rot:${Math.round(Math.random() * 360)}deg;`
        + `--dc-drift:${((Math.random() * 2 - 1) * 16).toFixed(1)}vw;`
        + `width:${w.toFixed(1)}px;height:${(w * 1.6).toFixed(1)}px;`
        + `animation-delay:${(Math.random() * 0.35).toFixed(2)}s;`
        + `animation-duration:${(2.2 + Math.random() * 1.4).toFixed(2)}s"></span>`;
    }
    host.innerHTML = html;
    document.body.appendChild(host);
    setTimeout(() => host.remove(), reduce ? 1800 : 4200);
  }

  function toast(msg, ms = 1800) {
    const t = $("#toast");
    t.textContent = msg;
    t.classList.remove("hidden");
    clearTimeout(toast._t);
    toast._t = setTimeout(() => t.classList.add("hidden"), ms);
  }
  function flashSaved(el) {
    if (!el) return;
    el.classList.add("show");
    clearTimeout(el._t);
    el._t = setTimeout(() => el.classList.remove("show"), 1500);
  }
  function escapeHtml(s) {
    return String(s ?? "").replace(/[&<>"']/g, (c) => ({
      "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;",
    }[c]));
  }

  // -------- Login / role flow --------
  function showLoginScreen(panel) {
    show($("#screen-login"));
    hide($("#screen-app"));
    hide($("#screen-client"));
    ["#login-role", "#login-setup", "#login-signin", "#login-client-import",
     "#login-athlete-setup", "#login-athlete-signin",
     "#login-forgot-password", "#login-reset-password"]
      .forEach((s) => { const el = $(s); if (el) hide(el); });
    const target = $(panel);
    if (target) show(target);
  }

  function showCoachSignin() {
    showLoginScreen("#login-signin");
    const trainer = state.trainerData.trainer;
    if (trainer?.name) {
      $("#login-hello").textContent = `Welcome back, ${trainer.name}`;
      $("#login-hello-sub").textContent = "Sign in with your email and password.";
    } else {
      $("#login-hello").textContent = "Coach sign in";
      $("#login-hello-sub").textContent = "Sign in with your email and password.";
    }
    if (trainer?.email) { $("#login-email").value = trainer.email; }
    else { $("#login-email").value = ""; }
    $("#login-pw").value = "";
    $("#login-error").classList.add("hidden");
    setTimeout(() => (trainer?.email ? $("#login-pw") : $("#login-email")).focus(), 50);
  }

  function pickRole(role) {
    if (role === "trainer") {
      // Always show sign-in first — new coaches click "Create account" from there
      showCoachSignin();
    } else {
      // Athlete sign in — always the email+password form. New athletes use the
      // separate "Athlete sign up" button, which goes to the invite-code flow.
      showAthleteSignin();
    }
  }

  function showAthleteImport() {
    showLoginScreen("#login-client-import");
    const btnResume = $("#btn-client-resume");
    const heading = $("#login-athlete-heading");
    const sub = $("#login-athlete-sub");
    heading.textContent = "Welcome, athlete";
    sub.innerHTML = `Enter the <strong>invite code</strong> from your coach.`;
    hide(btnResume);
    $("#invite-code-input").value = "";
    $("#client-code").value = "";
    $("#client-import-error").classList.add("hidden");
    setTimeout(() => $("#invite-code-input")?.focus(), 50);
  }

  function showAthleteSetup() {
    showLoginScreen("#login-athlete-setup");
    const program = state.clientData.program;
    const prefillName = state.clientData.profile?.name || program?.client?.name || "";
    $("#athlete-setup-name").value = prefillName;
    $("#athlete-setup-email").value = state.clientData.profile?.email || "";
    $("#athlete-setup-pw").value = "";
    $("#athlete-setup-pw-confirm").value = "";
    $("#athlete-setup-error").classList.add("hidden");
    setTimeout(() => {
      (prefillName ? $("#athlete-setup-email") : $("#athlete-setup-name")).focus();
    }, 50);
  }

  function showAthleteSignin() {
    showLoginScreen("#login-athlete-signin");
    const profile = state.clientData.profile;
    if (profile?.name) {
      const firstName = profile.name.trim().split(/\s+/)[0];
      $("#athlete-signin-heading").textContent = `Welcome back, ${firstName}`;
    } else {
      $("#athlete-signin-heading").textContent = "Welcome back";
    }
    const emailField = $("#athlete-signin-email");
    emailField.value = profile?.email || "";
    $("#athlete-signin-pw").value = "";
    $("#athlete-signin-error").classList.add("hidden");
    setTimeout(() => (profile?.email ? $("#athlete-signin-pw") : emailField).focus(), 50);
  }

  async function setupAthleteProfile() {
    const name = $("#athlete-setup-name").value.trim();
    const email = $("#athlete-setup-email").value.trim();
    const pw = $("#athlete-setup-pw").value;
    const conf = $("#athlete-setup-pw-confirm").value;
    const err = $("#athlete-setup-error");
    if (!name) return showErr(err, "Please enter your name.");
    if (!email) return showErr(err, "Please enter your email.");
    const pwCheck = validatePassword(pw);
    if (!pwCheck.ok) return showErr(err, pwCheck.message);
    if (pw !== conf) return showErr(err, "Passwords don't match.");
    if (!window.Cloud?.enabled) return showErr(err, "Cloud not available. Check your connection.");

    const btn = $("#btn-athlete-setup");
    btn.disabled = true; btn.textContent = "Saving…";
    try {
      let user;
      try {
        user = await window.Cloud.signUp(email, pw);
      } catch (signUpErr) {
        if (signUpErr.message === "EMAIL_CONFIRMATION_REQUIRED") {
          showErr(err, "Almost there! Check your email for a confirmation link, then come back and sign in.");
          btn.disabled = false; btn.textContent = "Save profile & continue";
          return;
        }
        if (signUpErr.message?.toLowerCase().includes("already")) {
          // Likely an orphaned auth account from a previously deleted athlete —
          // deleting an athlete removes their app data but not their Supabase
          // Auth login. Try signing into that existing account with the
          // password just entered and re-link it to this new athlete instead
          // of dead-ending here.
          try {
            user = await window.Cloud.signIn(email, pw);
          } catch (signInErr) {
            showErr(err, "An account with this email already exists, but that password doesn't match. Go back and use \"Forgot password?\" on the sign-in screen to reset it, then try again.");
            btn.disabled = false; btn.textContent = "Save profile & continue";
            return;
          }
        } else {
          throw signUpErr;
        }
      }
      const athleteId = state.clientData.program?.clientId;
      const inviteCode = state.clientData.program?.client?.inviteCode;
      if (athleteId) await window.Cloud.linkAthleteToAuth(athleteId, user.id, email, inviteCode);
      state.clientData.profile = { name, email, createdAt: Date.now() };
      saveClient();
      if (athleteId) window.Cloud.upsertAthleteProfile(athleteId, { name, email });
      setRememberMe(true); // default remember for new profile
      rememberEmail("athlete", email, true);
      err.classList.add("hidden");
      playLoginFlash();
      enterClientPortal();
      toast(`Profile saved. Welcome, ${name.split(/\s+/)[0]}!`);
    } catch (e) {
      showErr(err, e.message || "Failed to create account.");
    } finally {
      btn.disabled = false; btn.textContent = "Save profile & continue";
    }
  }

  async function signInAthlete() {
    const email = $("#athlete-signin-email").value.trim();
    const pw = $("#athlete-signin-pw").value;
    const err = $("#athlete-signin-error");
    const remember = $("#athlete-remember-me").checked;
    if (!email) return showErr(err, "Please enter your email.");
    if (!pw) return showErr(err, "Please enter your password.");
    if (!window.Cloud?.enabled) return showErr(err, "Cloud not available. Check your connection.");

    const btn = $("#btn-athlete-signin");
    btn.disabled = true; btn.textContent = "Signing in…";
    try {
      const user = await window.Cloud.signIn(email, pw);
      setRememberMe(remember);
      rememberEmail("athlete", email, remember);

      // Always refresh from the cloud so any workouts the coach just assigned
      // show up immediately, even on a device that already has this athlete's
      // program cached locally.
      let result = null;
      try {
        result = await window.Cloud.getAthleteByAuthUserId(user.id);
      } catch (e) {
        console.warn("[Cloud] refresh on sign-in failed, using cached program", e);
      }

      if (result?.athlete) {
        const { athlete, progress } = result;
        state.clientData.program = buildProgramFromAthlete(athlete);
        if (progress) state.clientData.progress = progress;
        if (!state.clientData.progress) state.clientData.progress = emptyProgress();
        ensureProgressShape(state.clientData.progress);
        state.clientData.profile = { name: athlete.name, email, createdAt: Date.now() };
        saveClient();
        err.classList.add("hidden");
        playLoginFlash();
        enterClientPortal();
        return;
      }

      // No fresh cloud record (offline, or lookup failed) — fall back to the
      // cached local program if this device already has one for this account.
      if (state.clientData.program && state.clientData.profile?.email === email) {
        err.classList.add("hidden");
        playLoginFlash();
        enterClientPortal();
        return;
      }

      await window.Cloud.signOut();
      showErr(err, "No athlete account found for this email. Ask your coach for an invite code.");
    } catch (e) {
      showErr(err, e.message || "Sign in failed.");
    } finally {
      btn.disabled = false; btn.textContent = "Sign in";
    }
  }

  function buildProgramFromAthlete(athlete) {
    return {
      kind: "tp-program", v: 2,
      clientId: athlete.id,
      trainerName: "",
      sharedAt: Date.now(),
      client: {
        id: athlete.id,
        name: athlete.name,
        age: athlete.age,
        heightIn: athlete.heightIn,
        weightLb: athlete.weightLb,
        goals: athlete.goals,
        weeks: athlete.weeks || [],
        oneOffDays: athlete.oneOffDays || [],
        schedule: athlete.schedule || {},
        coachPRs: athlete.coachPRs || [],
        inviteCode: athlete.inviteCode,
        sessionBank: athlete.sessionBank || { packages: [], redemptions: [] },
        nutrition: athlete.nutrition || { current: null, history: [] },
      },
    };
  }

  function forgetAthleteProfile() {
    if (!window.confirm("Forget this account on this device? Sign in with email + password on any device to restore your program.")) return;
    state.clientData = structuredClone(DEFAULT_CLIENT);
    saveClient();
    sessionStorage.removeItem(KEY_SESSION);
    _signOutOnLeave = false;
    if (window.Cloud?.enabled) window.Cloud.signOut();
    showAthleteImport();
    toast("Account forgotten");
  }

  function useNewInviteCode() {
    showAthleteImport();
  }

  // -------- Forgot / reset password --------
  function showForgotPassword(fromPanel) {
    _forgotFromPanel = fromPanel;
    const sourceEmail = fromPanel === "#login-signin"
      ? $("#login-email")?.value
      : $("#athlete-signin-email")?.value;
    showLoginScreen("#login-forgot-password");
    $("#forgot-pw-email").value = sourceEmail || "";
    $("#forgot-pw-error").classList.add("hidden");
    setTimeout(() => $("#forgot-pw-email").focus(), 50);
  }

  async function sendPasswordReset() {
    const email = $("#forgot-pw-email").value.trim();
    const err = $("#forgot-pw-error");
    if (!email) return showErr(err, "Please enter your email.");
    if (!window.Cloud?.enabled) return showErr(err, "Cloud not available. Check your connection.");
    const btn = $("#btn-send-reset");
    btn.disabled = true; btn.textContent = "Sending…";
    try {
      await window.Cloud.resetPassword(email);
      err.classList.add("hidden");
      toast("Reset link sent! Check your email.", 4000);
      showLoginScreen(_forgotFromPanel);
    } catch (e) {
      showErr(err, e.message || "Failed to send reset email.");
    } finally {
      btn.disabled = false; btn.textContent = "Send reset link";
    }
  }

  // -------- Password policy --------
  // Strict: 10+ chars, mixed upper/lower/number, and not an obviously common
  // password. NOTE: this is client-side UX only and can be bypassed by hitting
  // the API directly — the authoritative rules (min length + breach/leaked-
  // password rejection via HaveIBeenPwned) must be enabled in the Supabase
  // dashboard under Auth → Policies. Bcrypt hashing is handled by Supabase.
  const PASSWORD_MIN = 10;
  // Short guard list to catch the most obvious weak passwords before a network
  // round-trip. The real breach-corpus check is Supabase's leaked-password
  // protection — this is a convenience, not the line of defense.
  const COMMON_PASSWORDS = new Set([
    "password", "password1", "password12", "password123", "passw0rd12",
    "1234567890", "12345678910", "qwertyuiop", "qwerty12345", "1q2w3e4r5t",
    "letmein1234", "welcome1234", "iloveyou123", "admin12345", "changeme123",
    "trustno1234", "abcd123456", "football123", "monkey12345", "dragon12345",
  ]);
  function passwordChecks(pw) {
    return {
      length: pw.length >= PASSWORD_MIN,
      lower:  /[a-z]/.test(pw),
      upper:  /[A-Z]/.test(pw),
      number: /[0-9]/.test(pw),
      common: pw.length > 0 && !COMMON_PASSWORDS.has(pw.toLowerCase()),
    };
  }
  function validatePassword(pw) {
    const c = passwordChecks(pw);
    if (!c.length) return { ok: false, message: `Password must be at least ${PASSWORD_MIN} characters.` };
    if (!c.upper || !c.lower) return { ok: false, message: "Password needs both uppercase and lowercase letters." };
    if (!c.number) return { ok: false, message: "Password needs at least one number." };
    if (!c.common) return { ok: false, message: "That password is too common. Choose something harder to guess." };
    return { ok: true, message: "" };
  }
  // Live requirement checklist rendered under a password field.
  function renderPwReqs(pw, listEl) {
    if (!listEl) return;
    const c = passwordChecks(pw);
    const items = [
      [c.length, `At least ${PASSWORD_MIN} characters`],
      [c.upper && c.lower, "Upper & lowercase letters"],
      [c.number, "At least one number"],
      [c.common, "Not a common password"],
    ];
    listEl.innerHTML = items.map(([ok, label]) => {
      const state = !pw ? "" : ok ? "ok" : "bad";
      const mark = pw && ok ? "✓" : "•";
      return `<li class="pw-req ${state}"><span class="pw-req-mark">${mark}</span>${escapeHtml(label)}</li>`;
    }).join("");
  }
  function attachPwReqs(inputId, listId) {
    const input = $("#" + inputId);
    const list = $("#" + listId);
    if (!input || !list) return;
    const update = () => renderPwReqs(input.value, list);
    input.addEventListener("input", update);
    update();
  }

  async function submitPasswordReset() {
    const pw = $("#reset-pw-new").value;
    const conf = $("#reset-pw-confirm").value;
    const err = $("#reset-pw-error");
    const pwCheck = validatePassword(pw);
    if (!pwCheck.ok) return showErr(err, pwCheck.message);
    if (pw !== conf) return showErr(err, "Passwords don't match.");
    if (!window.Cloud?.enabled) return showErr(err, "Cloud not available. Check your connection.");
    const btn = $("#btn-reset-pw");
    btn.disabled = true; btn.textContent = "Updating…";
    try {
      await window.Cloud.updatePassword(pw);
      err.classList.add("hidden");
      toast("Password updated! Please sign in.", 3000);
      history.replaceState(null, "", window.location.pathname);
      await window.Cloud.signOut();
      showLoginScreen("#login-role");
    } catch (e) {
      showErr(err, e.message || "Failed to update password.");
    } finally {
      btn.disabled = false; btn.textContent = "Update password";
    }
  }

  // -------- Coach auth --------
  async function setupCoachAccount() {
    const name = $("#setup-name").value.trim();
    const email = $("#setup-email").value.trim();
    const pw = $("#setup-pw").value;
    const conf = $("#setup-pw-confirm").value;
    const err = $("#setup-error");
    if (!name) return showErr(err, "Please enter your name.");
    if (!email) return showErr(err, "Please enter your email.");
    const pwCheck = validatePassword(pw);
    if (!pwCheck.ok) return showErr(err, pwCheck.message);
    if (pw !== conf) return showErr(err, "Passwords don't match.");
    if (!window.Cloud?.enabled) return showErr(err, "Cloud not available. Check your connection.");

    const btn = $("#btn-setup");
    btn.disabled = true; btn.textContent = "Creating account…";
    try {
      let user;
      try {
        user = await window.Cloud.signUp(email, pw);
      } catch (signUpErr) {
        if (signUpErr.message === "EMAIL_CONFIRMATION_REQUIRED") {
          showErr(err, "Almost there! Check your email for a confirmation link, then come back and sign in.");
          btn.disabled = false; btn.textContent = "Create account";
          return;
        }
        if (signUpErr.message?.toLowerCase().includes("already registered") || signUpErr.message?.toLowerCase().includes("already")) {
          showErr(err, "An account with this email already exists. Sign in instead.");
          btn.disabled = false; btn.textContent = "Create account";
          return;
        }
        throw signUpErr;
      }

      const isMigration = !!state.trainerData.trainer;
      state.trainerData.trainer = { name, email };
      if (!state.trainerData.coachId) state.trainerData.coachId = uid();
      state.trainerData.coachAuthId = user.id;
      saveTrainer();
      await window.Cloud.upsertCoach(state.trainerData.coachId, name, email, user.id);
      if (isMigration) {
        for (const c of state.trainerData.clients) {
          await window.Cloud.upsertAthlete(c, state.trainerData.coachId);
        }
      }
      setRememberMe(true); // default remember for new account
      rememberEmail("coach", email, true);
      err.classList.add("hidden");
      playLoginFlash();
      signIntoTrainer();
      toast(isMigration ? "Account upgraded. Welcome!" : `Welcome, ${name.split(/\s+/)[0]}!`);
    } catch (e) {
      showErr(err, e.message || "Failed to create account.");
    } finally {
      btn.disabled = false; btn.textContent = "Create account";
    }
  }

  async function signInCoach() {
    const email = $("#login-email").value.trim();
    const pw = $("#login-pw").value;
    const err = $("#login-error");
    const remember = $("#coach-remember-me").checked;
    if (!email) return showErr(err, "Please enter your email.");
    if (!pw) return showErr(err, "Please enter your password.");
    if (!window.Cloud?.enabled) return showErr(err, "Cloud not available. Check your connection.");

    const btn = $("#btn-signin");
    btn.disabled = true; btn.textContent = "Signing in…";
    try {
      const user = await window.Cloud.signIn(email, pw);
      setRememberMe(remember);
      rememberEmail("coach", email, remember);

      // Always refresh from the cloud so programs/templates/athletes created
      // on any other device show up here immediately, even on a device that
      // already has a cached coach account.
      let coachData = null;
      try {
        coachData = await window.Cloud.getCoachByAuthUserId(user.id);
      } catch (e) {
        console.warn("[Cloud] refresh on coach sign-in failed, using cached data", e);
      }

      if (coachData) {
        populateCoachFromCloud(coachData.coach, coachData.athletes);
        err.classList.add("hidden");
        playLoginFlash();
        signIntoTrainer();
        return;
      }

      // No fresh cloud record (offline, or lookup failed) — fall back to the
      // cached local account if this device already has one.
      if (state.trainerData.trainer) {
        if (!state.trainerData.coachAuthId) {
          state.trainerData.coachAuthId = user.id;
          if (!state.trainerData.trainer.email) state.trainerData.trainer.email = email;
          saveTrainer();
          window.Cloud.upsertCoach(state.trainerData.coachId, state.trainerData.trainer.name, email, user.id);
        }
        err.classList.add("hidden");
        playLoginFlash();
        signIntoTrainer();
        return;
      }

      await window.Cloud.signOut();
      showErr(err, "No coach account found for this email. Create a new account.");
      setTimeout(() => showLoginScreen("#login-setup"), 1800);
    } catch (e) {
      showErr(err, e.message || "Sign in failed.");
    } finally {
      btn.disabled = false; btn.textContent = "Sign in";
    }
  }

  // Union two lists of {id,...} — cloud entries first so their order is kept,
  // local entries winning for shared ids (they hold the unsynced edit), and
  // local-only entries appended so a template created here but not yet pushed
  // survives the refresh.
  function mergeById(cloudList, localList) {
    const local = Array.isArray(localList) ? localList : [];
    const cloud = Array.isArray(cloudList) ? cloudList : [];
    const byId = new Map(local.map((t) => [t.id, t]));
    const out = cloud.map((t) => byId.get(t.id) || t);
    const seen = new Set(cloud.map((t) => t.id));
    local.forEach((t) => { if (!seen.has(t.id)) out.push(t); });
    return out;
  }

  function populateCoachFromCloud(coach, athletes, opts = {}) {
    state.trainerData.trainer = { name: coach.display_name || "", email: coach.email || "" };
    state.trainerData.coachId = coach.id;
    state.trainerData.coachAuthId = coach.auth_user_id;
    // Templates are stored as one array per coach, so neither "cloud wins" nor
    // "local wins" is safe: whichever side loses drops whatever the *other*
    // device created. With unsynced local work present we MERGE by id — the
    // cloud list is the base (so programs made on another device arrive here),
    // local versions win for ids we hold unsynced edits to, and local-only
    // templates are appended. Previously this kept the local array wholesale
    // and re-pushed it, wiping other devices' programs from the cloud.
    if (!opts.keepLocalTemplates) {
      state.trainerData.programTemplates = coach.program_templates || [];
      state.trainerData.workoutTemplates = coach.workout_templates || [];
    } else {
      state.trainerData.programTemplates =
        mergeById(coach.program_templates, state.trainerData.programTemplates);
      state.trainerData.workoutTemplates =
        mergeById(coach.workout_templates, state.trainerData.workoutTemplates);
    }
    // Exercise-library customizations, same dirty-flag protection as templates.
    // Missing keys (older rows, or the column not existing yet) keep local data.
    const prefs = coach.library_prefs || {};
    if (!opts.keepLocalLibPrefs) {
      if (Array.isArray(prefs.customExercises)) state.trainerData.customExercises = prefs.customExercises;
      if (Array.isArray(prefs.hiddenExercises)) state.trainerData.hiddenExercises = prefs.hiddenExercises;
      if (Array.isArray(prefs.exCatOrder)) state.trainerData.exCatOrder = prefs.exCatOrder;
      if (Array.isArray(prefs.athleteTemplates)) state.trainerData.athleteTemplates = prefs.athleteTemplates;
      if (Array.isArray(prefs.templateFolders)) state.trainerData.templateFolders = prefs.templateFolders;
    } else {
      // Unsynced local edits: merge by id like programTemplates, so a template
      // saved on this device and one saved on another both survive.
      state.trainerData.athleteTemplates =
        mergeById(prefs.athleteTemplates, state.trainerData.athleteTemplates);
      state.trainerData.templateFolders =
        mergeById(prefs.templateFolders, state.trainerData.templateFolders);
    }
    // Read-activity marks are a monotonic set (you never un-see a row), so
    // always UNION cloud with local regardless of the keepLocal flag — neither
    // side's dismissals should be lost. Leaving it undefined here (older rows
    // with no seenActivity key) lets renderOverviewActivity's first-run branch
    // adopt current activity as seen, exactly as before cloud sync existed.
    if (prefs.seenActivity || state.trainerData.seenActivity) {
      state.trainerData.seenActivity = {
        ...(prefs.seenActivity || {}),
        ...(state.trainerData.seenActivity || {}),
      };
    }
    state.trainerData.openSlots = coach.open_slots || [];
    // Athletes with unsynced local changes keep their local copy — the cloud
    // row may predate a write that never landed. Same protection templates get.
    const dirty = dirtyAthletes();
    const localById = new Map((state.trainerData.clients || []).map((c) => [c.id, c]));
    const merged = (athletes || []).map((a) => (dirty[a.id] && localById.get(a.id)) || a);
    // An athlete created locally that the cloud hasn't got yet isn't in the
    // incoming list at all, so it would otherwise disappear entirely.
    localById.forEach((c, id) => {
      if (dirty[id] && !merged.some((a) => a.id === id)) merged.push(c);
    });
    state.trainerData.clients = merged.map((a) => {
      if (!a.schedule) a.schedule = {};
      if (!a.coachPRs) a.coachPRs = [];
      if (!Array.isArray(a.oneOffDays)) a.oneOffDays = [];
      ensureSessionBank(a);
      if (!a.inviteCode) a.inviteCode = makeInviteCode();
      return a;
    });
    saveTrainer();
    localStorage.setItem(KEY_CLOUD_BACKFILLED, String(Date.now()));
  }

  function setRememberMe(remember) {
    _signOutOnLeave = !remember;
  }

  // Remembered sign-in emails (never passwords — the browser/keychain owns
  // those; the forms' autocomplete attributes let it offer to save them).
  const KEY_REMEMBER_EMAIL = "trainerpro_remember_email_v1";
  function loadRememberedEmails() {
    try { return JSON.parse(localStorage.getItem(KEY_REMEMBER_EMAIL)) || {}; }
    catch { return {}; }
  }
  function rememberEmail(role, email, remember) {
    const m = loadRememberedEmails();
    if (remember && email) m[role] = email; else delete m[role];
    localStorage.setItem(KEY_REMEMBER_EMAIL, JSON.stringify(m));
  }
  function prefillRememberedEmails() {
    const m = loadRememberedEmails();
    const coachEl = $("#login-email");
    const athleteEl = $("#athlete-signin-email");
    if (m.coach && coachEl && !coachEl.value) coachEl.value = m.coach;
    if (m.athlete && athleteEl && !athleteEl.value) athleteEl.value = m.athlete;
  }

  // The coach's home view (the training Overview) — used by the nav item and as
  // the landing view on sign-in / reload.
  function showCoachOverview() {
    _programEditorId = null;
    state.currentClientId = null;
    if (!state.dashCal) { const n = new Date(); state.dashCal = { year: n.getFullYear(), month: n.getMonth() }; }
    switchCoachView("overview");
    updateHeaderBreadcrumb(null);
    hideLibSidebar();
    renderDashboardCalendar();
    refreshCoachOpenSlots();
    renderBulletinBoard();
    renderOverviewRequests();
    renderOverviewActivity();
  }

  function signIntoTrainer() {
    state.mode = "trainer";
    sessionStorage.setItem(KEY_SESSION, "trainer");
    applyTheme(currentThemeForRole("coach"));
    hide($("#screen-login"));
    show($("#screen-app"));
    hide($("#screen-client"));
    $("#header-trainer-name").textContent = state.trainerData.trainer.name;
    // Populate the athletes grid + package badge in the background, then land on
    // the Overview page.
    renderDashboard();
    showCoachOverview();
    // First time on this device: one guided lap. Skippable, never repeats.
    if (!localStorage.getItem(KEY_TOUR_COACH)) {
      setTimeout(() => { if (state.mode === "trainer") startTour(coachTourSteps(), KEY_TOUR_COACH); }, 800);
    }
  }

  function signOutTrainer() {
    state.mode = null;
    sessionStorage.removeItem(KEY_SESSION);
    state.currentClientId = null;
    _signOutOnLeave = false;
    if (window.Cloud?.enabled) window.Cloud.signOut();
    showLoginScreen("#login-role");
  }

  function resetTrainerAccount() {
    if (!window.confirm("Delete coach account AND all athlete data on this device?")) return;
    state.trainerData = structuredClone(DEFAULT_TRAINER);
    saveTrainer();
    sessionStorage.removeItem(KEY_SESSION);
    _signOutOnLeave = false;
    if (window.Cloud?.enabled) window.Cloud.signOut();
    showLoginScreen("#login-role");
  }

  function showErr(el, msg) { el.textContent = msg; el.classList.remove("hidden"); }

  // -------- Dashboard --------
  // ------------ Coach view router ------------
  function switchCoachView(name) {
    const map = {
      athletes:        "#view-dashboard",
      overview:        "#view-overview",
      messages:        "#view-messages",
      anatomy:         "#view-anatomy",
      settings:        "#view-settings",
      programs:        "#view-programs",
      templates:       "#view-templates",
      "program-editor": "#view-program-editor",
      "day-library":   "#view-day-library",
      "day-editor":    "#view-day-editor",
      client:          "#view-client",
    };
    Object.values(map).forEach((sel) => { const el = $(sel); if (el) hide(el); });
    show($(map[name] || map.athletes));
    const navKey = { client: "athletes", "program-editor": "programs", "day-library": "programs", "day-editor": "programs", templates: "programs" }[name] || name;
    document.querySelectorAll('#coach-nav [data-coach-nav]').forEach((b) => {
      b.classList.toggle("active", b.dataset.coachNav === navKey);
    });
    if (name === "program-editor" || name === "day-editor") { showLibSidebar(); } else if (name !== "client") { hideLibSidebar(); }
  }

  // Coach profile page — reached by clicking the coach's name in the header,
  // mirroring the athlete profile. Holds identity, athlete count, appearance.
  function openCoachProfile() {
    _programEditorId = null;
    state.currentClientId = null;
    switchCoachView("settings");
    hideLibSidebar();
    const t = state.trainerData.trainer || {};
    const name = t.name || "Coach";
    const nameEl = $("#coach-profile-name"); if (nameEl) nameEl.textContent = name;
    const emailEl = $("#coach-profile-email"); if (emailEl) emailEl.textContent = t.email || "";
    const av = $("#coach-profile-avatar");
    if (av) { av.textContent = nameInitials(name); av.style.background = avatarColor(name); }
    const cnt = $("#coach-profile-clients");
    if (cnt) cnt.textContent = String(state.trainerData.clients?.length || 0);
    renderThemePicker($("#coach-theme-picker"), "coach");
    renderBackupNote();
  }

  // -------- Backup / restore --------
  // Cloud writes fail silently so the app keeps working offline, which means a
  // bad sync can cost real work. This is the escape hatch: one self-contained
  // file holding everything, restorable onto any device.
  const KEY_LAST_BACKUP = "trainerpro_last_backup_v1";
  const BACKUP_FORMAT = 1;

  function renderBackupNote() {
    const el = $("#backup-last"); if (!el) return;
    const ts = localStorage.getItem(KEY_LAST_BACKUP);
    el.textContent = ts
      ? `Last backup ${new Date(Number(ts)).toLocaleString()}`
      : "No backup downloaded yet.";
  }

  function backupCounts(data) {
    const clients = data.clients || [];
    return {
      athletes: clients.length,
      programs: (data.programTemplates || []).length,
      days: (data.workoutTemplates || []).length,
      weeks: clients.reduce((n, c) => n + (c.weeks || []).length, 0),
      logged: clients.reduce((n, c) =>
        n + Object.keys(c.importedProgress?.exerciseLogs || {}).length, 0),
    };
  }

  function exportAllData() {
    const data = state.trainerData || {};
    const payload = {
      format: BACKUP_FORMAT,
      app: "Stone Dragon Strength Training",
      exportedAt: new Date().toISOString(),
      counts: backupCounts(data),
      trainerData: data,
    };
    const stamp = todayISO();
    downloadFile(`stone-dragon-backup-${stamp}.json`, JSON.stringify(payload, null, 2), "application/json");
    localStorage.setItem(KEY_LAST_BACKUP, String(Date.now()));
    renderBackupNote();
    const c = payload.counts;
    toast(`Backup downloaded — ${c.athletes} athlete${c.athletes === 1 ? "" : "s"}, ${c.programs} program${c.programs === 1 ? "" : "s"} ✓`);
  }

  // Restore is destructive and pushes to the cloud, so it always shows what's
  // in the file next to what's here now, and never proceeds without a click.
  function importAllData(file) {
    const reader = new FileReader();
    reader.onload = () => {
      let payload;
      try { payload = JSON.parse(String(reader.result)); }
      catch { toast("That file isn't a valid backup"); return; }
      const incoming = payload?.trainerData || (payload?.clients ? payload : null);
      if (!incoming || !Array.isArray(incoming.clients)) {
        toast("That file isn't a Stone Dragon backup"); return;
      }
      const from = backupCounts(incoming);
      const now = backupCounts(state.trainerData || {});
      const when = payload.exportedAt
        ? new Date(payload.exportedAt).toLocaleString() : "unknown date";
      const row = (label, a, b) =>
        `<tr><td>${label}</td><td class="bk-num">${a}</td><td class="bk-num${b !== a ? " bk-diff" : ""}">${b}</td></tr>`;
      openModal({
        title: "Restore from backup",
        body: `
          <p class="muted" style="margin-top:0">Backup taken <strong>${escapeHtml(when)}</strong>.</p>
          <table class="backup-table">
            <thead><tr><th></th><th class="bk-num">Now</th><th class="bk-num">Backup</th></tr></thead>
            <tbody>
              ${row("Athletes", now.athletes, from.athletes)}
              ${row("Programs", now.programs, from.programs)}
              ${row("Saved days", now.days, from.days)}
              ${row("Program weeks", now.weeks, from.weeks)}
              ${row("Exercises with logs", now.logged, from.logged)}
            </tbody>
          </table>
          <p class="error-soft">This replaces everything currently on this device and pushes it to the cloud, overwriting your other devices. It cannot be undone.</p>`,
        actions: [
          { label: "Cancel", className: "btn btn-ghost", onClick: closeModal },
          { label: "Replace everything", className: "btn btn-danger", onClick: () => {
            // Keep this device's identity — the backup may predate it, and
            // swapping coachId/auth would orphan every cloud row.
            const keep = {
              coachId: state.trainerData.coachId,
              coachAuthId: state.trainerData.coachAuthId,
              trainer: state.trainerData.trainer,
            };
            state.trainerData = { ...incoming, ...keep };
            localStorage.setItem(KEY_TRAINER, JSON.stringify(state.trainerData));
            // Mark everything unsynced so the restored data is pushed up and
            // protected from being reverted by a stale cloud read on reload.
            localStorage.setItem(KEY_TEMPLATES_DIRTY, "1");
            (state.trainerData.clients || []).forEach((c) => markAthleteDirty(c.id));
            saveTrainer();
            (state.trainerData.clients || []).forEach((c) => pushAthlete(c));
            closeModal();
            toast(`Restored ${from.athletes} athlete${from.athletes === 1 ? "" : "s"} — syncing to the cloud`);
            renderDashboard();
          }},
        ],
      });
    };
    reader.onerror = () => toast("Couldn't read that file");
    reader.readAsText(file);
  }

  const AVATAR_COLORS = ["#06b6d4","#10b981","#8b5cf6","#f59e0b","#ef4444","#ec4899","#3b82f6","#f97316"];
  // Same eight hues as "r, g, b" so they can drive rgba() gradients/rails.
  const AVATAR_RGB = ["6, 182, 212","16, 185, 129","139, 92, 246","245, 158, 11","239, 68, 68","236, 72, 153","59, 130, 246","249, 115, 22"];
  function avatarColor(name) {
    const code = (name || "?").toUpperCase().charCodeAt(0);
    return AVATAR_COLORS[code % AVATAR_COLORS.length];
  }
  // Per-athlete accent index. Hashes the whole id (falling back to the name)
  // rather than avatarColor's first-letter-only rule, so a roster of Jake /
  // Jenna / Jordan doesn't come out three identical colors. Keyed on the id so
  // an athlete keeps their color through a rename.
  function athleteColorIdx(c) {
    const key = String(c?.id || c?.name || "?");
    let h = 5381;
    for (let i = 0; i < key.length; i++) h = ((h << 5) + h + key.charCodeAt(i)) | 0;
    return Math.abs(h) % AVATAR_COLORS.length;
  }
  function clientInitials(name) {
    return (name || "?").split(" ").map(p => p[0] || "").join("").slice(0, 2).toUpperCase();
  }
  function nameInitials(name) {
    const parts = (name || "?").trim().split(/\s+/);
    return (parts[0][0] + (parts[1]?.[0] || "")).toUpperCase();
  }

  function updateHeaderBreadcrumb(client) {
    const bc = $("#header-breadcrumb");
    const brand = $("#header-brand");
    if (client) {
      show(bc);
      hide(brand);
      $("#breadcrumb-athlete-name").textContent = client.name;
    } else {
      hide(bc);
      show(brand);
    }
  }

  // How far into their program an athlete has gotten — the furthest day (in
  // program order) with any logged completion. Used by the compact mobile
  // athlete card.
  function currentProgressLabel(c, totalDays, hasSyncedData, isComplete) {
    if (totalDays === 0) return "No program yet";
    if (!hasSyncedData) return "Not started yet";
    if (isComplete) return "Program complete ✓";
    const dc = c.importedProgress?.dayCompletions || {};
    let last = null;
    c.weeks.forEach((w) => {
      w.days.forEach((d) => {
        if ((dc[d.id] || []).length > 0) last = { week: w, day: d };
      });
    });
    if (!last) return "Not started yet";
    const wk = last.week.phaseLabel ? `${last.week.phaseLabel} ${last.week.label}` : last.week.label;
    const dayName = last.day.name.split(" — ")[0] || last.day.name;
    return `${wk} · ${dayName}`;
  }

  // Where the athlete is in their program: the first day, in program order,
  // that isn't checked off or fully logged in their last-synced progress.
  // Lands on the last day once everything's done; null if no program.
  function athleteCurrentDay(c) {
    if (!c) return null;
    const weeks = (c.weeks || []).filter((w) => (w.days || []).length);
    if (!weeks.length) return null;
    const dc = c.importedProgress?.dayCompletions || {};
    const logs = c.importedProgress?.exerciseLogs || {};
    const dayDone = (d) =>
      (dc[d.id] || []).length > 0 ||
      (d.exercises.length > 0 && d.exercises.every((ex) => (logs[ex.id] || []).length > 0));
    const flat = [];
    weeks.forEach((w) => w.days.forEach((d) => flat.push({ weekId: w.id, day: d })));
    // Anchor on the most recent activity: a skipped day back in week 1 must
    // not read as "the current day" forever once the athlete has moved on.
    const lastDate = (d) => {
      let max = "";
      (dc[d.id] || []).forEach((iso) => { if (String(iso) > max) max = String(iso); });
      (d.exercises || []).forEach((ex) =>
        (logs[ex.id] || []).forEach((l) => { if (String(l.date || "") > max) max = String(l.date); }));
      return max;
    };
    let anchorIdx = 0, anchorDate = "";
    flat.forEach((f, i) => {
      const dt = lastDate(f.day);
      if (dt && dt >= anchorDate) { anchorDate = dt; anchorIdx = i; }
    });
    // First not-done day at or after the latest activity, else first not-done
    // anywhere, else the last day of the program.
    for (let i = anchorIdx; i < flat.length; i++) {
      if (!dayDone(flat[i].day)) return { weekId: flat[i].weekId, dayId: flat[i].day.id };
    }
    for (const f of flat) if (!dayDone(f.day)) return { weekId: f.weekId, dayId: f.day.id };
    const last = flat[flat.length - 1];
    return { weekId: last.weekId, dayId: last.day.id };
  }

  // Open the coach program editor directly on one week/day of an athlete's
  // program (✏️ on athlete cards, "Edit this day" in the athlete preview).
  function editClientDay(clientId, weekId, dayId) {
    openClient(clientId);
    const c = currentClient();
    if (!c || !c.weeks.length) return;
    const wIdx = c.weeks.findIndex((w) => w.id === weekId);
    if (wIdx >= 0) {
      _coachActiveWeekIdx = wIdx;
      const dIdx = (c.weeks[wIdx].days || []).findIndex((d) => d.id === dayId);
      if (dIdx >= 0) c.weeks[wIdx]._activeDayIdx = dIdx;
    } else {
      // Unknown week (stale id from another athlete/session) — land on week 1
      // instead of whatever week index the editor last had open.
      _coachActiveWeekIdx = 0;
    }
    setTab("program");
    renderWeeks();
    setTimeout(() => $("#weeks-container")?.scrollIntoView({ behavior: "smooth", block: "start" }), 30);
  }

  let _packagesBadgeBootstrapped = false;
  function renderDashboard() {
    Nav.reset(); // coach root — Back from here exits the app
    state.currentClientId = null;
    switchCoachView("athletes");
    updateHeaderBreadcrumb(null);
    // One background pull per session so the session-balance chips on each
    // athlete card are fresh at login without opening every athlete.
    if (!_packagesBadgeBootstrapped && window.Cloud?.enabled) {
      _packagesBadgeBootstrapped = true;
      refreshAllAthletePackages();
    }
    renderClientGrid();
  }

  // Roster grouping: partition the athlete list under section headers.
  // The chosen mode persists per device.
  const KEY_ROSTER_GROUP = "trainerpro_roster_group_v1";
  function groupRoster(clients, mode) {
    if (mode === "membership") {
      const buckets = new Map();
      MEMBERSHIPS.forEach((m) => buckets.set(m.id, { label: `🏅 ${membershipTitle(m)}`, clients: [] }));
      buckets.set("", { label: "No membership", clients: [] });
      clients.forEach((c) => {
        const id = c.sessionBank?.membership || "";
        buckets.get(buckets.has(id) ? id : "").clients.push(c);
      });
      return [...buckets.values()].filter((g) => g.clients.length);
    }
    if (mode === "activity") {
      const act = { label: "🔥 Active this week", clients: [] };
      const quiet = { label: "😴 Quiet 7+ days", clients: [] };
      const none = { label: "❔ No activity yet", clients: [] };
      clients.forEach((c) => {
        const iso = lastActivityISO(c.importedProgress);
        if (!iso) return none.clients.push(c);
        const days = Math.floor((Date.now() - new Date(iso + "T12:00:00").getTime()) / 86400000);
        (days >= 7 ? quiet : act).clients.push(c);
      });
      return [act, quiet, none].filter((g) => g.clients.length);
    }
    if (mode === "program") {
      const run = { label: "🏃 In progress", clients: [] };
      const done = { label: "✅ Program complete", clients: [] };
      const no = { label: "📭 No program", clients: [] };
      clients.forEach((c) => {
        const totalDays = (c.weeks || []).reduce((n, w) => n + w.days.length, 0);
        if (!totalDays) return no.clients.push(c);
        const dc = c.importedProgress?.dayCompletions || {};
        const completed = c.weeks.reduce((n, w) =>
          n + w.days.filter((d) => (dc[d.id] || []).length > 0).length, 0);
        (completed === totalDays ? done : run).clients.push(c);
      });
      return [run, done, no].filter((g) => g.clients.length);
    }
    return [{ label: "", clients }];
  }

  // Re-render just the athlete cards (no view switch). Safe to call after a
  // package approve/decline or a background refresh to update the 🎟 chips.
  function renderClientGrid() {
    const grid = $("#client-grid");
    const empty = $("#client-empty");
    if (!grid) return;
    grid.innerHTML = "";

    const controls = $("#roster-controls");
    if (state.trainerData.clients.length === 0) {
      show(empty);
      if (controls) hide(controls);
      return;
    }
    hide(empty);

    const groupMode = localStorage.getItem(KEY_ROSTER_GROUP) || "none";
    if (controls) {
      show(controls);
      $$("#roster-controls [data-roster-group]").forEach((b) =>
        b.classList.toggle("active", b.dataset.rosterGroup === groupMode));
    }

    const sorted = [...state.trainerData.clients].sort((a, b) => a.name.localeCompare(b.name));
    for (const group of groupRoster(sorted, groupMode)) {
    if (group.label) {
      const head = document.createElement("div");
      head.className = "roster-section-head";
      head.textContent = `${group.label} · ${group.clients.length}`;
      grid.appendChild(head);
    }
    for (const c of group.clients) {
      const weekCount = c.weeks.length;
      const exerciseCount = c.weeks.reduce((n, w) => n + w.days.reduce((m, d) => m + d.exercises.length, 0), 0);
      const totalDays = c.weeks.reduce((n, w) => n + w.days.length, 0);
      const dc = c.importedProgress?.dayCompletions || {};
      const completedDays = c.weeks.reduce((n, w) =>
        n + w.days.filter((d) => (dc[d.id] || []).length > 0).length, 0);
      const pct = totalDays ? Math.round((completedDays * 100) / totalDays) : 0;
      const isComplete = completedDays === totalDays && totalDays > 0;
      const hasSyncedData = c.importedProgress && (
        Object.keys(c.importedProgress.dayCompletions || {}).length > 0 ||
        Object.keys(c.importedProgress.exerciseLogs || {}).length > 0
      );

      // Compact horizontal row: avatar · name+details · progress.
      const card = document.createElement("div");
      card.className = "client-row";
      // Per-athlete accent — drives the card's gradient wash and left rail as
      // well as the avatar, so the two always agree. See .client-row in styles.css.
      const colorIdx = athleteColorIdx(c);
      card.style.setProperty("--athlete-rgb", AVATAR_RGB[colorIdx]);

      const avatar = document.createElement("div");
      avatar.className = "client-avatar";
      avatar.style.background = AVATAR_COLORS[colorIdx];
      avatar.textContent = nameInitials(c.name);

      const main = document.createElement("div");
      main.className = "client-row-main";
      const nameEl = document.createElement("div");
      nameEl.className = "client-row-name";
      nameEl.textContent = c.name;
      const subEl = document.createElement("div");
      subEl.className = "client-row-sub";
      // Where they are in their program (current week · day), not raw counts.
      subEl.textContent = currentProgressLabel(c, totalDays, hasSyncedData, isComplete);
      // Quiet flag: no logged activity in 7+ days → retention nudge. Lives on
      // the name line (the sub line ellipsizes and would swallow it).
      const lastAct = lastActivityISO(c.importedProgress);
      if (lastAct) {
        const quietDays = Math.floor((Date.now() - new Date(lastAct + "T12:00:00").getTime()) / 86400000);
        if (quietDays >= 7) {
          const q = document.createElement("span");
          q.className = "quiet-chip";
          q.title = `No logged activity since ${lastAct}`;
          q.textContent = `😴 ${quietDays}d`;
          nameEl.appendChild(q);
        }
      }
      const cPartner = partnerOf(c);
      if (cPartner) {
        const pc = document.createElement("span");
        pc.className = "quiet-chip partner-chip";
        pc.title = `Shares a session bank with ${cPartner.name || "partner"}`;
        pc.textContent = "💞";
        nameEl.appendChild(pc);
      }
      main.appendChild(nameEl);
      main.appendChild(subEl);

      const prog = document.createElement("div");
      prog.className = "client-row-prog";
      if (totalDays === 0) {
        prog.classList.add("no-data");
        prog.innerHTML = `<span class="client-row-prog-status">No program</span>`;
      } else if (!hasSyncedData) {
        prog.classList.add("no-data");
        prog.innerHTML = `<span class="client-row-prog-status" title="Awaiting sync">No sync</span>`;
      } else {
        if (isComplete) prog.classList.add("complete");
        prog.innerHTML = `
          <div class="client-row-prog-top">
            <span class="pct">${pct}%</span>
            <span class="days">${completedDays}/${totalDays} days</span>
          </div>
          <div class="progress-track"><div class="progress-fill" style="width:${pct}%"></div></div>`;
      }

      card.appendChild(avatar);
      card.appendChild(main);
      card.appendChild(prog);

      // Session-balance chip + pending-request badge (moved here from the old
      // Packages page). Only shown once an athlete has any package activity.
      const sum = sessionBankSummary(c);
      const pendingCount = openRequestsFor(c).length;
      if (sum.granted > 0 || sum.used > 0 || pendingCount > 0) {
        const sess = document.createElement("div");
        sess.className = "client-row-sessions";
        const chip = document.createElement("span");
        chip.className = "booked-balance-chip" + (sum.remaining <= 1 ? " low" : "");
        chip.textContent = `🎟 ${sum.remaining}`;
        sess.appendChild(chip);
        if (pendingCount) {
          const pend = document.createElement("span");
          pend.className = "pkg-track-pending";
          pend.textContent = `${pendingCount} req`;
          sess.appendChild(pend);
        }
        // Tapping the chips jumps straight to that athlete's Sessions tab,
        // where packages are approved/managed (the rest of the card → profile).
        sess.addEventListener("click", (e) => { e.stopPropagation(); Nav.push(renderDashboard); openClient(c.id); setTab("sessions"); });
        card.appendChild(sess);
      }

      // Quick "live session" — opens the athlete's current day in their own
      // logging UI, with every entry saving to the athlete's account. (The old
      // read-only 👁️ preview was retired 2026-07-17 — this is the one door in.)
      const logBtn = document.createElement("button");
      logBtn.className = "client-row-view";
      logBtn.type = "button";
      logBtn.title = `Fill out ${c.name || "athlete"}'s workout`;
      logBtn.setAttribute("aria-label", `Log ${c.name || "athlete"}'s workout in a live session`);
      logBtn.textContent = "🏋️";
      logBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        state.currentClientId = c.id;
        Nav.push(exitPreview); // Back leaves the live session
        previewAsAthlete();
      });
      card.appendChild(logBtn);

      card.addEventListener("click", () => { Nav.push(renderDashboard); openClient(c.id); setTab("profile"); });
      grid.appendChild(card);
    }
    }
    fitClientRowNames();
    requestAnimationFrame(fitClientRowNames); // again post-layout, in case the view was still hidden
  }

  // Names stay on one line: shrink the font until the full name fits its row
  // (9px floor, where ellipsis takes over). Mobile rows are too narrow for
  // long names at the default size.
  function fitClientRowNames() {
    $$("#client-grid .client-row-name").forEach((el) => {
      el.style.fontSize = "";
      if (!el.clientWidth) return;
      let px = parseFloat(getComputedStyle(el).fontSize);
      while (el.scrollWidth > el.clientWidth && px > 9) {
        px -= 0.5;
        el.style.fontSize = px + "px";
      }
    });
  }
  window.addEventListener("resize", () => requestAnimationFrame(fitClientRowNames));

  // -------- Athlete Templates (own space, organised into folders) ----------
  // Separate from programTemplates on purpose: these are snapshots saved off a
  // real athlete, and the coach wanted somewhere to file them away long-term
  // without cluttering the Programs build list. Each template sits in exactly
  // one folder; folderId "" means Unsorted.
  function ensureAthleteTemplates() {
    const d = state.trainerData;
    if (!Array.isArray(d.athleteTemplates)) d.athleteTemplates = [];
    if (!Array.isArray(d.templateFolders)) d.templateFolders = [];
    // A template pointing at a deleted folder falls back to Unsorted rather
    // than disappearing from every view.
    const ids = new Set(d.templateFolders.map((f) => f.id));
    d.athleteTemplates.forEach((t) => { if (t.folderId && !ids.has(t.folderId)) t.folderId = ""; });
  }
  // Which folder the Templates view is filtered to. "" = Unsorted, null = All.
  let _tplFolderFilter = null;

  function tplFolderName(id) {
    if (!id) return "Unsorted";
    return (state.trainerData.templateFolders || []).find((f) => f.id === id)?.name || "Unsorted";
  }

  function renderTemplatesView() {
    ensureAthleteTemplates();
    _programEditorId = null;
    state.currentClientId = null;
    switchCoachView("templates");
    updateHeaderBreadcrumb(null);
    hideLibSidebar();
    const bar = $("#tpl-folder-bar");
    const grid = $("#tpl-grid");
    const empty = $("#tpl-empty");
    if (!bar || !grid) return;
    const all = state.trainerData.athleteTemplates;
    const folders = state.trainerData.templateFolders;

    // ── Folder chips: All, each folder, then Unsorted when anything needs it ──
    const count = (fid) => all.filter((t) => (t.folderId || "") === fid).length;
    const chip = (id, label, n, active) =>
      `<button type="button" class="tpl-folder-chip${active ? " active" : ""}" data-folder="${id === null ? "__all" : escapeHtml(id)}">`
      + `${escapeHtml(label)}<span class="tpl-folder-count">${n}</span></button>`;
    let chips = chip(null, "All", all.length, _tplFolderFilter === null);
    folders.forEach((f) => { chips += chip(f.id, f.name, count(f.id), _tplFolderFilter === f.id); });
    if (count("") || _tplFolderFilter === "") chips += chip("", "Unsorted", count(""), _tplFolderFilter === "");
    bar.innerHTML = chips;
    bar.querySelectorAll("[data-folder]").forEach((b) => b.addEventListener("click", () => {
      const v = b.dataset.folder;
      _tplFolderFilter = v === "__all" ? null : v;
      renderTemplatesView();
    }));

    grid.innerHTML = "";
    if (!all.length) { show(empty); hide(grid); return; }
    hide(empty); show(grid);

    const shown = _tplFolderFilter === null ? all : all.filter((t) => (t.folderId || "") === _tplFolderFilter);
    if (!shown.length) {
      grid.innerHTML = `<p class="muted" style="padding:0.6em 0">Nothing in this folder yet.</p>`;
      return;
    }
    const inner = document.createElement("div");
    inner.className = "coach-row-grid";
    [...shown].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
      .forEach((t) => inner.appendChild(makeAthleteTemplateCard(t)));
    grid.appendChild(inner);
  }

  function makeAthleteTemplateCard(tpl) {
    const weeks = (tpl.weeks || []).length;
    const days = (tpl.weeks || []).reduce((n, w) => n + (w.days || []).length, 0);
    const exs = (tpl.weeks || []).reduce((n, w) => n + (w.days || []).reduce((m, d) => m + (d.exercises || []).length, 0), 0);
    const row = document.createElement("div");
    row.className = "coach-row tpl-row";
    row.innerHTML = `
      <div class="coach-row-icon">🗂</div>
      <div class="coach-row-main">
        <div class="coach-row-name">${escapeHtml(tpl.name || "Untitled")}</div>
        <div class="coach-row-sub">${weeks} wk · ${days} day${days === 1 ? "" : "s"} · ${exs} ex`
        + `${tpl.fromAthlete ? ` · from ${escapeHtml(tpl.fromAthlete)}` : ""}</div>
      </div>
      <span class="tpl-folder-tag">${escapeHtml(tplFolderName(tpl.folderId))}</span>
      <div class="coach-row-actions">
        <button class="btn btn-ghost btn-sm" data-act="move" type="button">Move…</button>
        <button class="btn btn-primary btn-sm" data-act="assign" type="button">Assign</button>
        <button class="btn-delete-mini" data-act="del" type="button" title="Delete template">×</button>
      </div>`;
    row.querySelector('[data-act="move"]').addEventListener("click", (e) => { e.stopPropagation(); openMoveTemplateModal(tpl); });
    row.querySelector('[data-act="assign"]').addEventListener("click", (e) => { e.stopPropagation(); assignAthleteTemplate(tpl); });
    row.querySelector('[data-act="del"]').addEventListener("click", (e) => {
      e.stopPropagation();
      if (!window.confirm(`Delete "${tpl.name || "this template"}"?`)) return;
      state.trainerData.athleteTemplates = state.trainerData.athleteTemplates.filter((t) => t.id !== tpl.id);
      saveTrainer(); renderTemplatesView();
    });
    return row;
  }

  function openNewTemplateFolder() {
    ensureAthleteTemplates();
    openModal({
      title: "New folder",
      body: `<label>Folder name
        <input type="text" id="tpl-folder-name" maxlength="40" placeholder="e.g. Hypertrophy, Beginners, Rehab" />
      </label>`,
      actions: [
        { label: "Cancel", className: "btn btn-ghost", onClick: closeModal },
        { label: "Create", className: "btn btn-primary", onClick: () => {
          const name = $("#tpl-folder-name").value.trim();
          if (!name) { toast("Give the folder a name"); return; }
          state.trainerData.templateFolders.push({ id: uid(), name });
          saveTrainer(); closeModal(); renderTemplatesView(); toast(`Folder "${name}" created ✓`);
        }},
      ],
    });
    setTimeout(() => $("#tpl-folder-name")?.focus(), 60);
  }

  // Move / rename / delete folders all live here — one place the coach can
  // reorganise from, rather than scattering folder controls around the grid.
  function openMoveTemplateModal(tpl) {
    ensureAthleteTemplates();
    const folders = state.trainerData.templateFolders;
    const opt = (id, label) =>
      `<option value="${escapeHtml(id)}"${(tpl.folderId || "") === id ? " selected" : ""}>${escapeHtml(label)}</option>`;
    openModal({
      title: `Move "${tpl.name || "template"}"`,
      body: `<label>Folder
          <select id="tpl-move-folder" class="msg-select">
            ${opt("", "Unsorted")}${folders.map((f) => opt(f.id, f.name)).join("")}
          </select>
        </label>
        <label>Rename template
          <input type="text" id="tpl-move-name" maxlength="80" value="${escapeHtml(tpl.name || "")}" />
        </label>`,
      actions: [
        { label: "Cancel", className: "btn btn-ghost", onClick: closeModal },
        { label: "Save", className: "btn btn-primary", onClick: () => {
          tpl.folderId = $("#tpl-move-folder").value;
          const nm = $("#tpl-move-name").value.trim();
          if (nm) tpl.name = nm;
          saveTrainer(); closeModal(); renderTemplatesView(); toast("Saved ✓");
        }},
      ],
    });
  }

  // Same copy semantics as assigning a program template: fresh ids, and no
  // live link — these are snapshots, not subscriptions.
  function assignAthleteTemplate(tpl) {
    const clients = state.trainerData.clients || [];
    if (!clients.length) { toast("Add an athlete first"); return; }
    let selectedId = null;
    const cards = clients.map((c) => `<div class="assign-athlete-card" data-cid="${escapeHtml(c.id)}">
        <div class="assign-athlete-name">${escapeHtml(c.name)}</div>
        <div class="assign-athlete-sub">${(c.weeks || []).length ? `${c.weeks.length} week${c.weeks.length === 1 ? "" : "s"} currently` : "No program yet"}</div>
      </div>`).join("");
    const doAssign = () => {
      const c = clients.find((x) => x.id === selectedId);
      if (!c) { toast("Select an athlete first"); return; }
      c.weeks = JSON.parse(JSON.stringify(tpl.weeks || [])).map((w) => ({
        ...w, id: uid(),
        days: (w.days || []).map((d) => ({
          ...d, id: uid(),
          exercises: (d.exercises || []).map((e) => ({ ...e, id: uid() })),
        })),
      }));
      delete c.assignedProgramId; // snapshot, never a live link
      delete c.tplShape;
      state.currentClientId = c.id;
      saveTrainer();
      pushAthlete(c);
      closeModal();
      toast(`"${tpl.name || "Template"}" loaded onto ${c.name} ✓`);
    };
    openModal({
      title: `Assign "${tpl.name || "Template"}"`,
      body: `<p class="muted" style="margin-bottom:0.75em">Pick an athlete. This replaces their current program.</p>
             <div class="assign-athlete-grid">${cards}</div>`,
      actions: [
        { label: "Cancel", className: "btn btn-ghost", onClick: closeModal },
        { label: "Assign →", className: "btn btn-primary", onClick: doAssign },
      ],
    });
    $("#modal-body").querySelectorAll(".assign-athlete-card").forEach((card) => {
      card.addEventListener("click", () => {
        selectedId = card.dataset.cid;
        $("#modal-body").querySelectorAll(".assign-athlete-card").forEach((c) => c.classList.toggle("selected", c === card));
      });
    });
  }

  // -------- Program Templates --------
  function ensureProgramTemplates() {
    if (!Array.isArray(state.trainerData.programTemplates)) {
      state.trainerData.programTemplates = [];
    }
    // Backfill draft/ready status on programs saved before the split existed.
    state.trainerData.programTemplates.forEach((p) => {
      if (p.status !== "ready" && p.status !== "draft") p.status = "draft";
    });
  }

  function setProgramStatus(tpl, status) {
    tpl.status = status;
    saveTrainer();
    if (status === "ready") toast(`"${tpl.name || "Program"}" marked ready to assign ✓`);
    else toast(`"${tpl.name || "Program"}" moved back to in progress`);
  }

  function makeProgramCard(tpl) {
    const weekCount = tpl.weeks.length;
    const daysPerWeek = tpl.weeks.reduce((max, w) => Math.max(max, w.days.length), 0);
    const exCount = tpl.weeks.reduce((n, w) => n + w.days.reduce((m, d) => m + d.exercises.length, 0), 0);
    const ready = tpl.status === "ready";

    // Compact 2-column row (matches the Athletes list). Whole row opens the
    // editor; status toggling also lives in the editor's status button.
    const row = document.createElement("div");
    row.className = "coach-row";

    const icon = document.createElement("div");
    icon.className = "coach-row-icon";
    icon.textContent = "📋";

    const main = document.createElement("div");
    main.className = "coach-row-main";
    const nameEl = document.createElement("div");
    nameEl.className = "coach-row-name";
    nameEl.textContent = tpl.name || "Untitled Program";
    const sub = document.createElement("div");
    sub.className = "coach-row-sub";
    sub.textContent = `${weekCount} wk${weekCount !== 1 ? "s" : ""} · ${daysPerWeek} day${daysPerWeek !== 1 ? "s" : ""}/wk · ${exCount} ex`;
    main.appendChild(nameEl);
    main.appendChild(sub);

    const actions = document.createElement("div");
    actions.className = "coach-row-actions";

    if (ready) {
      const assignBtn = document.createElement("button");
      assignBtn.className = "btn btn-primary btn-sm";
      assignBtn.textContent = "Assign";
      assignBtn.addEventListener("click", (e) => { e.stopPropagation(); assignProgramPrompt(tpl.id); });
      actions.appendChild(assignBtn);
    } else {
      const readyBtn = document.createElement("button");
      readyBtn.className = "btn btn-ghost btn-sm";
      readyBtn.textContent = "✓ Ready";
      readyBtn.title = "Mark ready to assign";
      readyBtn.addEventListener("click", (e) => { e.stopPropagation(); setProgramStatus(tpl, "ready"); renderProgramsList(); });
      actions.appendChild(readyBtn);
    }

    const deleteBtn = document.createElement("button");
    deleteBtn.className = "btn-delete-mini";
    deleteBtn.title = "Delete program";
    deleteBtn.textContent = "×";
    deleteBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (!window.confirm(`Delete "${tpl.name || "this program"}"?`)) return;
      state.trainerData.programTemplates = state.trainerData.programTemplates.filter((p) => p.id !== tpl.id);
      saveTrainer(); renderProgramsList();
    });
    actions.appendChild(deleteBtn);

    row.appendChild(icon);
    row.appendChild(main);
    row.appendChild(actions);
    row.addEventListener("click", () => openProgramEditor(tpl.id));
    return row;
  }

  function renderProgramsList() {
    ensureProgramTemplates();
    _programEditorId = null;
    switchCoachView("programs");
    updateHeaderBreadcrumb(null);
    const grid = $("#program-template-grid");
    const empty = $("#program-template-empty");
    grid.innerHTML = "";
    const templates = state.trainerData.programTemplates;
    if (!templates.length) { show(empty); hide(grid); return; }
    hide(empty); show(grid);

    const inProgress = templates.filter((t) => t.status !== "ready");
    const ready = templates.filter((t) => t.status === "ready");

    const section = (title, hint, list) => {
      const sec = document.createElement("div");
      sec.className = "program-section";
      const head = document.createElement("div");
      head.className = "program-section-head";
      head.innerHTML = `<span class="program-section-title">${escapeHtml(title)}</span><span class="program-section-count">${list.length}</span>`;
      sec.appendChild(head);
      if (list.length) {
        const inner = document.createElement("div");
        inner.className = "coach-row-grid";
        list.forEach((tpl) => inner.appendChild(makeProgramCard(tpl)));
        sec.appendChild(inner);
      } else {
        const none = document.createElement("p");
        none.className = "program-section-empty muted";
        none.textContent = hint;
        sec.appendChild(none);
      }
      return sec;
    };

    grid.appendChild(section("🟡 In progress", "Nothing in progress. New programs land here.", inProgress));
    grid.appendChild(section("🟢 Ready to assign", "No finished programs yet. Mark one complete when it's ready.", ready));
  }

  // ── Template → assigned-athlete live sync ──
  // "Assign to athlete" stamps client.assignedProgramId. From then on, edits in
  // the Programs editor rewrite each linked athlete's copy (exercises matched
  // by name within the same day so logged history stays attached).
  //
  // The coach's direct edits to an athlete win. Previously the template
  // clobbered them on its next save, silently deleting days and exercises the
  // coach had added for that athlete alone. Now each sync records the shape it
  // wrote; if the athlete's program no longer matches that shape, the coach has
  // edited them directly, so they're unlinked and left alone instead.
  let _tplSyncTimer = null;
  function linkedClientsFor(tplId) {
    return state.trainerData.clients.filter((c) => c.assignedProgramId === tplId);
  }
  // Structural fingerprint: day names + exercise names, per week. Deliberately
  // ignores sets/weights/reps — tweaking a load isn't "taking ownership", but
  // adding or removing a day or exercise is.
  function programShape(weeks) {
    return (weeks || []).map((w) =>
      (w.days || []).map((d) =>
        `${String(d.name || "").trim().toLowerCase()}:` +
        (d.exercises || []).map((e) => String(e.name || "").trim().toLowerCase()).join("|")
      ).join(">")
    ).join("#");
  }
  function scheduleTemplateSync(tplId) {
    clearTimeout(_tplSyncTimer);
    _tplSyncTimer = setTimeout(() => {
      const tpl = (state.trainerData.programTemplates || []).find((p) => p.id === tplId);
      if (!tpl) return;
      const linked = linkedClientsFor(tplId);
      if (!linked.length) return;
      const unlinked = [];
      linked.forEach((c) => {
        // tplShape is what the last sync wrote. A mismatch means the coach has
        // since edited this athlete directly — hand the program over to them.
        if (c.tplShape && programShape(c.weeks) !== c.tplShape) {
          delete c.assignedProgramId;
          delete c.tplShape;
          unlinked.push(c.name);
          return;
        }
        syncWeeksFromTemplate(c, tpl);
        c.tplShape = programShape(c.weeks);
        if (window.Cloud?.enabled) window.Cloud.debounce(`athlete:${c.id}`, () =>
          window.Cloud.upsertAthlete(c, state.trainerData.coachId));
      });
      localStorage.setItem(KEY_TRAINER, JSON.stringify(state.trainerData));
      if (unlinked.length) {
        toast(`${unlinked.join(", ")} ${unlinked.length === 1 ? "has" : "have"} custom edits — kept as-is, no longer following this program`);
        refreshProgramEditorLinked(tpl);
      }
    }, 800);
  }
  function syncWeeksFromTemplate(client, tpl) {
    const oldWeeks = client.weeks || [];
    client.weeks = (tpl.weeks || []).map((tw, wi) => {
      const ow = oldWeeks[wi];
      const oldDays = ow?.days || [];
      return {
        ...structuredClone(tw),
        id: ow?.id || uid(),
        days: (tw.days || []).map((td, di) => {
          const od = oldDays[di];
          const pool = (od?.exercises || []).slice(); // consumed as names match
          return {
            ...structuredClone(td),
            id: od?.id || uid(),
            exercises: (td.exercises || []).map((te) => {
              const key = String(te.name || "").trim().toLowerCase();
              const mi = pool.findIndex((oe) => String(oe.name || "").trim().toLowerCase() === key);
              const match = mi >= 0 ? pool.splice(mi, 1)[0] : null;
              return { ...structuredClone(te), id: match ? match.id : uid() };
            }),
          };
        }),
      };
    });
  }
  function refreshProgramEditorLinked(tpl) {
    const el = $("#program-editor-linked");
    if (!el) return;
    const n = linkedClientsFor(tpl.id).length;
    if (!n) { hide(el); return; }
    const names = linkedClientsFor(tpl.id).map((c) => c.name).join(", ");
    el.textContent = `🔗 Live on ${n} athlete${n === 1 ? "" : "s"} (${names}). Edits here update their program.`;
    show(el);
  }

  function openProgramEditor(id) {
    ensureProgramTemplates();
    _programEditorId = id;
    _coachActiveWeekIdx = 0;
    const tpl = currentProgramTemplate(); if (!tpl) return;
    switchCoachView("program-editor");
    updateHeaderBreadcrumb({ name: tpl.name || "Program" });
    $("#program-editor-name").value = tpl.name || "";
    $("#program-editor-desc").value = tpl.description || "";
    updateProgramStatusBtn(tpl);
    refreshProgramEditorLinked(tpl);
    renderWeeks();
  }

  function updateProgramStatusBtn(tpl) {
    const btn = $("#btn-toggle-program-status");
    if (!btn) return;
    const ready = tpl.status === "ready";
    btn.textContent = ready ? "✓ Ready · reopen" : "Mark complete ✓";
    btn.classList.toggle("is-ready", ready);
    btn.title = ready ? "This program is ready to assign. Click to move back to in progress" : "Mark this program complete and ready to assign";
  }

  function newProgram() {
    ensureProgramTemplates();
    const tpl = {
      id: uid(), name: "", description: "", status: "draft",
      weeks: Array.from({ length: 1 }, (_, i) => { const w = makeWeek(i); w.days = [makeDay(1)]; return w; }),
      createdAt: Date.now(),
    };
    state.trainerData.programTemplates.push(tpl);
    saveTrainer();
    openProgramEditor(tpl.id);
    setTimeout(() => $("#program-editor-name").focus(), 80);
  }

  // Promote an athlete's program up into the reusable Program Library. Archive
  // only files a copy under that one athlete — this makes it assignable to
  // anyone. The copy is deliberately INDEPENDENT: fresh ids throughout and no
  // assignedProgramId link, so later edits to the template never rewrite this
  // athlete's live program out from under them.
  function saveClientProgramToLibrary() {
    const c = currentClient(); if (!c) return;
    if (!c.weeks || !c.weeks.length) { toast("This athlete has no program to save"); return; }
    ensureAthleteTemplates();
    const weekCount = c.weeks.length;
    const exCount = c.weeks.reduce((n, w) => n + (w.days || []).reduce((m, d) => m + (d.exercises || []).length, 0), 0);
    const first = (c.name || "").trim().split(/\s+/)[0] || "Athlete";
    const suggested = `${first}'s Program`;
    const folders = state.trainerData.templateFolders;
    const save = () => {
      const name = $("#lib-save-name").value.trim() || suggested;
      const tpl = {
        id: uid(),
        name,
        description: $("#lib-save-desc").value.trim(),
        folderId: $("#lib-save-folder")?.value || "",
        fromAthlete: c.name || "",
        weeks: JSON.parse(JSON.stringify(c.weeks)).map((w) => ({
          ...w, id: uid(),
          days: (w.days || []).map((d) => ({
            ...d, id: uid(),
            exercises: (d.exercises || []).map((e) => ({ ...e, id: uid() })),
          })),
        })),
        createdAt: Date.now(),
      };
      state.trainerData.athleteTemplates.push(tpl);
      saveTrainer();
      closeModal();
      toast(`"${name}" saved to Templates ✓`);
    };
    openModal({
      title: "Save to Templates",
      body: `
        <p class="muted" style="margin-top:0">Saves a copy of ${escapeHtml(c.name || "this athlete")}'s program
        (${weekCount} week${weekCount === 1 ? "" : "s"} · ${exCount} exercise${exCount === 1 ? "" : "s"})
        into <strong>Programs → Templates</strong>, where you can file it in a folder and reuse it on anyone.</p>
        <label>Template name
          <input type="text" id="lib-save-name" maxlength="80" placeholder="${escapeHtml(suggested)}" value="${escapeHtml(suggested)}" />
        </label>
        <label>Folder
          <select id="lib-save-folder" class="msg-select">
            <option value="">Unsorted</option>
            ${folders.map((f) => `<option value="${escapeHtml(f.id)}">${escapeHtml(f.name)}</option>`).join("")}
          </select>
        </label>
        <label>Description (optional)
          <input type="text" id="lib-save-desc" maxlength="120" placeholder="e.g. 8-week hypertrophy block" />
        </label>
        <p class="muted" style="font-size:0.78rem">This is an independent copy — editing it later won't change ${escapeHtml(c.name || "this athlete")}'s current program.</p>`,
      actions: [
        { label: "Cancel", className: "btn btn-ghost", onClick: closeModal },
        { label: "Save to Templates", className: "btn btn-primary", onClick: save },
      ],
    });
    setTimeout(() => $("#lib-save-name")?.select(), 60);
  }

  function assignProgramPrompt(tplId) {
    const tpl = (state.trainerData.programTemplates || []).find((p) => p.id === tplId);
    if (!tpl) return;
    const clients = state.trainerData.clients;
    if (!clients.length) { toast("No athletes yet. Add one first."); return; }

    let selectedId = null;

    const cardsHtml = clients.map((c) => {
      const weekCount = c.weeks?.length || 0;
      return `<div class="assign-athlete-card" data-cid="${escapeHtml(c.id)}">
        <div class="assign-athlete-name">${escapeHtml(c.name)}</div>
        <div class="assign-athlete-meta">${weekCount ? weekCount + " week" + (weekCount !== 1 ? "s" : "") + " currently" : "No program yet"}</div>
      </div>`;
    }).join("");

    openModal({
      title: `Assign "${tpl.name || "Program"}"`,
      body: `<p class="muted" style="margin-bottom:0.75em">Pick an athlete to receive this program.</p>
             <div class="assign-athlete-grid">${cardsHtml}</div>`,
      actions: [
        { label: "Cancel", className: "btn btn-ghost", onClick: closeModal },
        { label: "Assign →", className: "btn btn-primary", onClick: () => {
          if (!selectedId) { toast("Select an athlete first"); return; }
          const client = clients.find((c) => c.id === selectedId);
          if (!client) return;

          const doAssign = (archiveFirst) => {
            if (archiveFirst) {
              if (!Array.isArray(client.archivedPrograms)) client.archivedPrograms = [];
              const d = new Date();
              client.archivedPrograms.unshift({
                id: uid(),
                label: "Archived: " + d.toLocaleDateString("en-US", { month: "long", year: "numeric" }),
                archivedAt: d.toISOString(),
                weeks: JSON.parse(JSON.stringify(client.weeks)),
                schedule: JSON.parse(JSON.stringify(client.schedule || {})),
              });
            }
            client.weeks = JSON.parse(JSON.stringify(tpl.weeks)).map((w) => ({
              ...w, id: uid(),
              days: w.days.map((d) => ({
                ...d, id: uid(),
                exercises: d.exercises.map((e) => ({ ...e, id: uid() })),
              })),
            }));
            client.assignedProgramId = tpl.id; // template edits live-sync here
            // Baseline for divergence detection — see scheduleTemplateSync.
            // Without it the first template edit would read as "coach edited
            // this athlete" and immediately unlink them.
            client.tplShape = programShape(client.weeks);
            // Target this athlete for the cloud push. saveTrainer() only syncs
            // state.currentClientId, which may be a different athlete (or none)
            // when assigning from the Programs tab — so point it here first and
            // push this athlete directly so their program actually reaches the
            // cloud (and their device).
            state.currentClientId = client.id;
            saveTrainer();
            pushAthlete(client); // tracked: stays dirty until the cloud confirms
            closeModal();
            toast(archiveFirst
              ? `Archived old program & assigned "${tpl.name || "Program"}" to ${client.name} ✓`
              : `"${tpl.name || "Program"}" assigned to ${client.name} ✓`);
            // Land back on the Programs page — assigning is usually done from
            // there, and the toast already confirms who got it.
            renderProgramsList();
          };

          if (client.weeks.length > 0) {
            const wk = client.weeks.length;
            openModal({
              title: `Replace ${client.name}'s program?`,
              body: `<p style="margin-bottom:0.5em">${client.name} already has a ${wk}-week program.</p>
                     <p class="muted">Archive it before replacing so you can view it later?</p>`,
              actions: [
                { label: "Cancel", className: "btn btn-ghost", onClick: closeModal },
                { label: "Replace only", className: "btn btn-ghost", onClick: () => doAssign(false) },
                { label: "Archive & replace", className: "btn btn-primary", onClick: () => doAssign(true) },
              ],
            });
          } else {
            doAssign(false);
          }
        }},
      ],
    });

    $("#modal-body").querySelectorAll(".assign-athlete-card").forEach((card) => {
      card.addEventListener("click", () => {
        $("#modal-body").querySelectorAll(".assign-athlete-card").forEach((el) => el.classList.remove("selected"));
        card.classList.add("selected");
        selectedId = card.dataset.cid;
      });
    });
  }

  function openLoadProgramModal() {
    const c = currentClient(); if (!c) return;
    const programs = state.trainerData.programTemplates || [];

    if (!programs.length) {
      openModal({
        title: "Load Program",
        body: `<div class="empty-state" style="padding:2em 1em">
          <div class="empty-emoji">📂</div>
          <h3>No programs yet</h3>
          <p>Go to <strong>Programs</strong> in the sidebar to create one first.</p>
        </div>`,
        actions: [{ label: "Close", className: "btn btn-ghost", onClick: closeModal }],
      });
      return;
    }

    const cardsHtml = programs.map((p) => {
      const weekCount = p.weeks.length;
      const dayCount  = p.weeks.reduce((n, w) => n + w.days.length, 0);
      const exCount   = p.weeks.reduce((n, w) => n + w.days.reduce((m, d) => m + d.exercises.length, 0), 0);
      const phases    = [...new Set(p.weeks.map((w) => w.phaseLabel).filter(Boolean))];
      const phaseHtml = phases.map((ph) => `<span class="meta-pill">${escapeHtml(ph)}</span>`).join("");
      return `<div class="load-prog-card" data-pid="${escapeHtml(p.id)}">
        <div class="load-prog-name">${escapeHtml(p.name || "Untitled Program")}</div>
        ${p.description ? `<div class="load-prog-desc">${escapeHtml(p.description)}</div>` : ""}
        <div class="load-prog-pills">
          <span class="meta-pill">${weekCount} week${weekCount !== 1 ? "s" : ""}</span>
          <span class="meta-pill">${dayCount} day${dayCount !== 1 ? "s" : ""}</span>
          <span class="meta-pill">${exCount} exercise${exCount !== 1 ? "s" : ""}</span>
          ${phaseHtml}
        </div>
      </div>`;
    }).join("");

    openModal({
      title: "Load Program",
      body: `<p class="muted" style="margin-bottom:0.8em">Choose a program to load into <strong>${escapeHtml(c.name)}</strong>'s training plan.</p>
             <div class="load-prog-grid">${cardsHtml}</div>`,
      actions: [{ label: "Cancel", className: "btn btn-ghost", onClick: closeModal }],
    });

    $("#modal-body").querySelectorAll(".load-prog-card").forEach((card) => {
      const pid = card.dataset.pid;
      const p = programs.find((x) => x.id === pid);
      if (!p) return;
      card.addEventListener("click", () => {
        const doLoad = (archiveFirst) => {
          if (archiveFirst) {
            if (!Array.isArray(c.archivedPrograms)) c.archivedPrograms = [];
            const d = new Date();
            c.archivedPrograms.unshift({
              id: uid(),
              label: "Archived: " + d.toLocaleDateString("en-US", { month: "long", year: "numeric" }),
              archivedAt: d.toISOString(),
              weeks: JSON.parse(JSON.stringify(c.weeks)),
              schedule: JSON.parse(JSON.stringify(c.schedule || {})),
            });
          }
          c.weeks = JSON.parse(JSON.stringify(p.weeks)).map((w) => ({
            ...w, id: uid(),
            days: w.days.map((d) => ({
              ...d, id: uid(),
              exercises: d.exercises.map((e) => ({ ...e, id: uid() })),
            })),
          }));
          // Load Program is a one-time copy, like Save to Library in reverse:
          // it deliberately does NOT set assignedProgramId. Linking here meant
          // any later template edit silently rewrote this athlete's program,
          // deleting days/exercises the coach had added just for them. Use
          // "Assign to athlete" when a live link is actually wanted.
          delete c.assignedProgramId;
          delete c.tplShape;
          saveTrainer();
          pushAthlete(c); // tracked: stays dirty until the cloud confirms
          closeModal();
          renderWeeks(); renderDiet(); renderCoachCalendar();
          toast(archiveFirst
            ? `Archived old program & loaded "${p.name || "Program"}" ✓`
            : `"${p.name || "Program"}" loaded ✓`);
        };

        if (c.weeks.length > 0) {
          openModal({
            title: `Replace ${c.name}'s program?`,
            body: `<p style="margin-bottom:0.5em">${c.name} already has a ${c.weeks.length}-week program.</p>
                   <p class="muted">Archive it before replacing so you can view it later?</p>`,
            actions: [
              { label: "Cancel", className: "btn btn-ghost", onClick: closeModal },
              { label: "Replace only", className: "btn btn-ghost", onClick: () => doLoad(false) },
              { label: "Archive & replace", className: "btn btn-primary", onClick: () => doLoad(true) },
            ],
          });
        } else {
          doLoad(false);
        }
      });
    });
  }

  function addClientPrompt() {
    openModal({
      title: "Add new athlete",
      body: `
        <label>Athlete name<input type="text" id="new-client-name" placeholder="e.g. Jamie Lee" autofocus /></label>`,
      actions: [
        { label: "Cancel", className: "btn btn-ghost", onClick: closeModal },
        { label: "Add athlete", className: "btn btn-primary", onClick: () => {
            const name = $("#new-client-name").value.trim();
            if (!name) return;
            const c = makeClient(name);
            state.trainerData.clients.push(c);
            saveTrainer();
            // Immediate push so cross-device login works the moment the coach shares the invite code.
            if (window.Cloud?.enabled && state.trainerData.coachId) {
              window.Cloud.upsertAthlete(c, state.trainerData.coachId);
            }
            closeModal();
            openClient(c.id);
            toast("Athlete added");
          },
        },
      ],
    });
    setTimeout(() => $("#new-client-name")?.focus(), 50);
  }

  // -------- Client detail --------
  function openClient(id) {
    const c = state.trainerData.clients.find((x) => x.id === id);
    if (!c) return renderDashboard();
    // The client view edits the athlete's own copy, never a template. A stale
    // editor id here made renderWeeks show the template instead of the
    // athlete's program (the "Edit this day lands on a random program" bug).
    _programEditorId = null;
    _coachActiveWeekIdx = 0;
    _prEditIds = new Set();
    _prNewLifts = [];
    if (!c.schedule) c.schedule = {};
    if (!c.coachPRs) c.coachPRs = [];
    ensureSessionBank(c);
    state.currentClientId = id;
    switchCoachView("client");
    updateHeaderBreadcrumb(c);
    $("#client-name-display").textContent = c.name;
    $("#client-meta-display").textContent = clientMetaText(c);
    setTab("profile");
    renderProfile();
    renderWeeks();
    renderDiet();
    renderClientLogs();
    renderCoachPRs();
    renderStrengthProgress($("#coach-strength-charts"), c, c.importedProgress || {});
    renderCoachSessions();
    const now = new Date();
    state.coachCal = { year: now.getFullYear(), month: now.getMonth() };
    renderCoachCalendar();
    // Opening an athlete starts at the top — on mobile the dashboard's scroll
    // position otherwise carries over and lands mid-page.
    window.scrollTo(0, 0);
    // Pull the latest athlete progress from the cloud (non-blocking).
    if (window.Cloud?.enabled) pullProgressFromCloud(c);
  }
  async function pullProgressFromCloud(c) {
    if (!window.Cloud?.enabled) return;
    const [cloudProgress, cloudAthlete] = await Promise.all([
      window.Cloud.getProgress(c.id),
      window.Cloud.getAthleteById(c.id),
    ]);
    let changed = false;
    if (cloudProgress) { c.importedProgress = { ...cloudProgress, syncedAt: Date.now() }; changed = true; }
    if (cloudAthlete?.coachPRs) { c.coachPRs = cloudAthlete.coachPRs; changed = true; }
    if (!changed) return;
    localStorage.setItem(KEY_TRAINER, JSON.stringify(state.trainerData));
    if (state.currentClientId === c.id) {
      renderClientLogs();
      renderCoachCalendar();
      renderCoachPRs();
    }
  }
  function clientMetaText(c) {
    const parts = [];
    if (c.age) parts.push(`${c.age} yrs`);
    if (c.heightIn) parts.push(formatHeight(c.heightIn));
    if (c.weightLb) parts.push(`${c.weightLb} lb`);
    return parts.join(" · ") || "Profile incomplete";
  }
  function currentClient() { return state.trainerData.clients.find((x) => x.id === state.currentClientId); }
  function setTab(name) {
    state.currentTab = name;
    $$(".tab[data-tab]").forEach((t) => t.classList.toggle("active", t.dataset.tab === name));
    $$(".tab-panel[data-tab-panel]").forEach((p) => p.classList.toggle("active", p.dataset.tabPanel === name));
    if (name === "program") { showLibSidebar(); } else { hideLibSidebar(); }
    if (name === "archive") {
      const c = currentClient();
      renderArchiveSection(c);
      const empty = $("#archive-empty");
      if (empty) empty.classList.toggle("hidden", !!(c?.archivedPrograms?.length));
    }
  }

  // -------- Profile --------
  function formatHeight(heightIn) {
    const h = Number(heightIn);
    if (!h) return "";
    return `${Math.floor(h / 12)}'${Math.round(h % 12)}"`;
  }
  const PROFILE_FIELD_IDS = [
    "#prof-name", "#prof-age", "#prof-height-ft", "#prof-height-in",
    "#prof-weight", "#prof-goals", "#prof-notes",
  ];
  function setProfileLocked(locked) {
    PROFILE_FIELD_IDS.forEach((sel) => {
      const el = $(sel); if (!el) return;
      if (locked) el.setAttribute("readonly", "readonly");
      else el.removeAttribute("readonly");
    });
    // <select> can't use readonly — toggle disabled instead.
    const memSel = $("#prof-membership");
    if (memSel) memSel.disabled = locked;
    $(".profile-card")?.classList.toggle("locked", locked);
    hide(locked ? $("#btn-profile-save") : $("#btn-profile-edit"));
    show(locked ? $("#btn-profile-edit") : $("#btn-profile-save"));
  }
  function renderProfile() {
    const c = currentClient(); if (!c) return;
    $("#prof-name").value = c.name;
    $("#prof-age").value = c.age;
    const h = Number(c.heightIn) || 0;
    $("#prof-height-ft").value = h ? Math.floor(h / 12) : "";
    $("#prof-height-in").value = h ? Math.round(h % 12) : "";
    $("#prof-weight").value = c.weightLb || "";
    $("#prof-goals").value = c.goals;
    $("#prof-notes").value = c.notes;
    if (!c.inviteCode) { c.inviteCode = makeInviteCode(); saveTrainer(); }
    $("#invite-code-display").textContent = c.inviteCode;
    setInviteCodeVisible(false); // code stays tucked away until "Show code"
    populateMembershipSelect(c);
    const autoRenewBox = $("#prof-autorenew");
    if (autoRenewBox) autoRenewBox.checked = !!c.sessionBank?.autoRenew;
    setProfileLocked(true);
  }
  function populateMembershipSelect(c) {
    const sel = $("#prof-membership"); if (!sel) return;
    ensureSessionBank(c);
    const current = c.sessionBank?.membership || "";
    let html = `<option value="">No membership set</option>`;
    let lastCat = null;
    MEMBERSHIPS.forEach((m) => {
      if (m.cat !== lastCat) {
        if (lastCat !== null) html += `</optgroup>`;
        html += `<optgroup label="${escapeHtml(m.cat)}">`;
        lastCat = m.cat;
      }
      const label = m.optLabel || `${m.perWeek}× / week · ${m.sessions} sessions/mo · $${m.price.toLocaleString()}`;
      html += `<option value="${m.id}">${label}</option>`;
    });
    if (lastCat !== null) html += `</optgroup>`;
    sel.innerHTML = html;
    sel.value = current;
    refreshGrantBtn();
  }
  // Keeps the "Grant this month's N sessions" button label + enabled state in
  // sync with the currently-selected membership tier.
  function refreshGrantBtn() {
    const btn = $("#btn-grant-month"); if (!btn) return;
    const m = membershipById($("#prof-membership")?.value);
    btn.disabled = !m || !m.sessions;
    btn.textContent = m && m.sessions
      ? `＋ Grant this month's ${m.sessions} sessions`
      : `＋ Grant this month's sessions`;
  }
  // Adds one month's worth of sessions (per the selected membership tier) to the
  // athlete's pool as a paid package. Guards against granting the same month twice.
  function grantMembershipMonth() {
    const c = currentClient(); if (!c) return;
    const m = membershipById($("#prof-membership")?.value);
    if (!m) { toast("Pick a membership first"); return; }
    if (!m.sessions) { toast("This membership has no sessions to grant"); return; }
    ensureSessionBank(c);
    const monthKey = new Date().toISOString().slice(0, 7); // YYYY-MM
    const monthLabel = new Date().toLocaleDateString("en-US", { month: "long", year: "numeric" });
    const already = (c.sessionBank.packages || []).some((p) => p.membershipGrant === monthKey);
    if (already && !window.confirm(`You already granted ${monthLabel}'s sessions to ${c.name || "this athlete"}. Grant another ${m.sessions}?`)) return;
    // Keep the saved membership in step with what's shown, then grant.
    c.sessionBank.membership = m.id;
    c.sessionBank.packages.push({
      id: uid(), size: m.sessions, status: "paid", price: m.price,
      addedAt: Date.now(), paidAt: Date.now(),
      note: `Membership: ${membershipTitle(m)} · ${monthLabel}`,
      membershipGrant: monthKey,
    });
    bankMutated(c);
    saveTrainer();
    toast(`Granted ${m.sessions} sessions for ${monthLabel} ✓`);
  }
  function saveProfileFields() {
    const c = currentClient(); if (!c) return;
    c.name = $("#prof-name").value;
    c.age = $("#prof-age").value;
    c.weightLb = $("#prof-weight").value;
    c.goals = $("#prof-goals").value;
    c.notes = $("#prof-notes").value;
    const ft = Number($("#prof-height-ft").value) || 0;
    const inch = Number($("#prof-height-in").value) || 0;
    c.heightIn = (ft * 12 + inch) || "";
    ensureSessionBank(c);
    c.sessionBank.membership = $("#prof-membership")?.value || "";
    bankMutated(c);
    saveTrainer();
    $("#client-name-display").textContent = c.name || "(unnamed)";
    $("#client-meta-display").textContent = clientMetaText(c);
    flashSaved($("#prof-saved"));
    setProfileLocked(true);
  }
  // The raw code is hidden by default — the email invite link is the main
  // flow now, so the code + copy/regen only appear behind "Show code".
  function setInviteCodeVisible(vis) {
    [$("#invite-code-display"), $("#btn-copy-invite"), $("#btn-regen-invite")]
      .forEach((el) => el && (vis ? show(el) : hide(el)));
    const btn = $("#btn-show-invite");
    if (btn) btn.textContent = vis ? "Hide code" : "Show code";
  }
  function regenerateInviteCode() {
    const c = currentClient(); if (!c) return;
    if (!window.confirm("Regenerate this athlete's invite code? Any old code stops working. If they've already signed in, this resets their access. They'll re-enter the new code to reconnect.")) return;
    c.inviteCode = makeInviteCode();
    saveTrainer();
    // Clear the auth link so the row is unclaimed and can be claimed fresh with
    // the new code (the hardened claim RPC won't re-link an active account).
    if (window.Cloud?.enabled) window.Cloud.unlinkAthleteAuth(c.id);
    $("#invite-code-display").textContent = c.inviteCode;
    toast("New code generated");
  }
  async function copyInviteCode() {
    const c = currentClient(); if (!c) return;
    try { await navigator.clipboard.writeText(c.inviteCode); toast("Code copied"); }
    catch { toast("Couldn't copy. Code: " + c.inviteCode, 4000); }
  }
  // Opens the coach's mail app with a prefilled invite: a deep link that lands
  // the athlete on the invite screen with their code already entered.
  function emailInviteLink() {
    const c = currentClient(); if (!c) return;
    if (!c.inviteCode) { c.inviteCode = makeInviteCode(); saveTrainer(); }
    const link = `${APP_URL}?invite=${c.inviteCode}`;
    const first = (c.name || "").trim().split(/\s+/)[0];
    const subject = "Your Stone Dragon Strength training app invite";
    const body = [
      `Hi${first ? " " + first : ""},`,
      "",
      "Here's your invite to the Stone Dragon Strength training app. Your programs, workout logging, and progress tracking all live there.",
      "",
      "Tap this link to get set up (your invite code fills in automatically):",
      link,
      "",
      `If the link doesn't work, open ${APP_URL} , tap "Athlete sign up", and enter this invite code: ${c.inviteCode}`,
      "",
      "See you in the gym!",
    ].join("\n");
    window.location.href = `mailto:?subject=${encodeURIComponent(subject)}&body=${encodeURIComponent(body)}`;
  }
  function bindProfileInputs() {
    $("#btn-profile-edit").addEventListener("click", () => {
      setProfileLocked(false);
      $("#prof-name").focus();
    });
    $("#btn-profile-save").addEventListener("click", saveProfileFields);
    $("#prof-membership")?.addEventListener("change", refreshGrantBtn);
    $("#btn-grant-month")?.addEventListener("click", grantMembershipMonth);
    $("#prof-autorenew")?.addEventListener("change", (e) => {
      const c = currentClient(); if (!c) return;
      ensureSessionBank(c);
      c.sessionBank.autoRenew = e.target.checked;
      bankMutated(c);
      saveTrainer();
      toast(e.target.checked
        ? "🔁 Auto-renew on: each month grants a package sized to their bookings"
        : "Auto-renew off");
    });
  }
  // ============ Workout Templates (library) ============
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

  // Curated, original starter templates organized by category. Coach taps a card
  // to add a copy (with fresh IDs) to their library.
  const RECOMMENDED_TEMPLATES = {
    "Push / Chest": [
      { name: "Heavy Bench Day", focus: "Strength priority on chest press · core finisher",
        ex: [["Bench Press","5","5"],["Overhead Press","4","6"],["Incline Dumbbell Press","3","10"],["Cable Fly","3","12"],["Triceps Pressdown","3","12"],["Cable Crunch","3","15"]] },
      { name: "Volume Push", focus: "Hypertrophy for chest, shoulders, triceps · core finisher",
        ex: [["Incline Bench Press","4","10"],["Seated Dumbbell Press","4","10"],["Cable Crossover","3","12"],["Lateral Raise","4","15"],["Overhead Triceps Extension","3","12"],["Hanging Leg Raise","3","12"]] },
      { name: "Bodyweight Push", focus: "Travel or gym-free push session · core finisher",
        ex: [["Push-up","4","AMRAP"],["Dip","4","8"],["Pike Push-up","3","10"],["Diamond Push-up","3","10"],["Plank","3","60s"]] },
      { name: "Shoulders + Triceps Pump", focus: "Delt/triceps detail work · core finisher",
        ex: [["Seated Dumbbell Press","4","8"],["Lateral Raise","4","15"],["Rear-Delt Fly","3","15"],["Skull Crusher","3","10"],["Triceps Pressdown","3","12"],["Hollow Hold","3","30s"]] },
      { name: "Incline Power", focus: "Upper-chest strength emphasis · core finisher",
        ex: [["Incline Barbell Press","5","5"],["Weighted Dip","4","6"],["Machine Chest Press","3","10"],["Cable Fly","3","15"],["Overhead Triceps Extension","3","12"],["Cable Crunch","3","15"]] },
      { name: "Dumbbell Push Day", focus: "Joint-friendly dumbbell chest/shoulders · core finisher",
        ex: [["Flat Dumbbell Press","4","10"],["Incline Dumbbell Press","4","10"],["Arnold Press","3","10"],["Lateral Raise","4","15"],["Dumbbell Skull Crusher","3","12"],["Plank","3","60s"]] },
      { name: "Chest Hypertrophy", focus: "High-volume chest pump · core finisher",
        ex: [["Barbell Bench Press","4","10"],["Incline Cable Fly","3","15"],["Pec Deck","3","15"],["Push-up","3","AMRAP"],["Triceps Pressdown","4","12"],["Hanging Leg Raise","3","12"]] },
    ],
    "Back / Pull": [
      { name: "Heavy Pull Day", focus: "Strength priority on back + biceps · core finisher",
        ex: [["Deadlift","5","3"],["Barbell Row","4","6"],["Pull-up","4","AMRAP"],["Face Pull","3","15"],["Hammer Curl","3","10"],["Hanging Knee Raise","3","12"]] },
      { name: "Width-Focused Back", focus: "Lat width + thickness · core finisher",
        ex: [["Wide-Grip Lat Pulldown","4","10"],["Seated Cable Row","4","10"],["Single-Arm Dumbbell Row","3","10"],["Straight-Arm Pulldown","3","12"],["Barbell Curl","3","10"],["Ab Wheel Rollout","3","10"]] },
      { name: "Posterior Chain", focus: "Hinge + glute/ham work · anti-rotation core",
        ex: [["Romanian Deadlift","4","8"],["Hip Thrust","4","10"],["Hyperextension","3","12"],["Leg Curl","3","12"],["Cable Pull-Through","3","12"],["Pallof Press","3","12 each"]] },
      { name: "Bicep + Back Detail", focus: "Pump-focused back & biceps · core finisher",
        ex: [["Lat Pulldown","4","12"],["Chest-Supported Row","4","10"],["Preacher Curl","3","10"],["Incline Dumbbell Curl","3","12"],["Reverse Crunch","3","15"]] },
      { name: "Deadlift + Back", focus: "Heavy pull with rowing volume · core finisher",
        ex: [["Deadlift","5","3"],["Pendlay Row","4","6"],["Wide-Grip Lat Pulldown","3","10"],["Face Pull","3","15"],["Barbell Curl","3","10"],["Hanging Leg Raise","3","12"]] },
      { name: "Cable Pull Day", focus: "Constant-tension back & biceps · core finisher",
        ex: [["Seated Cable Row","4","12"],["Cable Lat Pulldown","4","12"],["Straight-Arm Pulldown","3","15"],["Cable Curl","3","12"],["Cable Face Pull","3","15"],["Cable Crunch","3","15"]] },
      { name: "Upper Back Detail", focus: "Traps, rear delts, thickness · core finisher",
        ex: [["Chest-Supported Row","4","10"],["Reverse Pec Deck","4","15"],["Dumbbell Shrug","4","12"],["Hammer Curl","3","12"],["Ab Wheel Rollout","3","10"]] },
    ],
    "Legs": [
      { name: "Squat Focus", focus: "Quad-dominant strength session · core finisher",
        ex: [["Back Squat","5","5"],["Front Squat","3","6"],["Walking Lunge","3","12"],["Leg Press","3","10"],["Standing Calf Raise","4","15"],["Weighted Plank","3","45s"]] },
      { name: "Deadlift Focus", focus: "Hinge-dominant strength session · core finisher",
        ex: [["Conventional Deadlift","5","3"],["Romanian Deadlift","4","8"],["Bulgarian Split Squat","3","10"],["Leg Curl","3","12"],["Standing Calf Raise","4","15"],["Side Plank","3","30s each"]] },
      { name: "Hypertrophy Legs", focus: "High-volume leg pump · core finisher",
        ex: [["Leg Press","5","12"],["Bulgarian Split Squat","4","10"],["Leg Extension","4","12"],["Leg Curl","4","12"],["Walking Lunge","3","12"],["Standing Calf Raise","5","15"],["Decline Sit-up","3","15"]] },
      { name: "Glute + Hamstring Day", focus: "Posterior leg emphasis · core finisher",
        ex: [["Hip Thrust","5","8"],["Romanian Deadlift","4","10"],["Glute Ham Raise","3","8"],["Cable Kickback","3","12 each"],["Seated Leg Curl","4","12"],["Hanging Leg Raise","3","12"]] },
      { name: "Front Squat Focus", focus: "Quad + core-braced strength · core finisher",
        ex: [["Front Squat","5","5"],["Back Squat","3","8"],["Leg Press","3","12"],["Leg Extension","3","15"],["Standing Calf Raise","4","15"],["Weighted Plank","3","45s"]] },
      { name: "Unilateral Legs", focus: "Single-leg balance & symmetry · core finisher",
        ex: [["Bulgarian Split Squat","4","10 each"],["Walking Lunge","3","12"],["Step-Up","3","10 each"],["Single-Leg Curl","3","12 each"],["Single-Leg Calf Raise","3","15 each"],["Side Plank","3","30s each"]] },
      { name: "Quad Burnout", focus: "High-rep quad pump finisher · core finisher",
        ex: [["Leg Press","5","15"],["Leg Extension","4","20"],["Goblet Squat","3","15"],["Walking Lunge","3","20"],["Standing Calf Raise","5","20"],["Decline Sit-up","3","15"]] },
    ],
    "Conditioning + Core": [
      { name: "EMOM Finisher", focus: "10-min metabolic finisher after main lift",
        ex: [["Burpee","1","10"],["Kettlebell Swing","1","15"],["Box Jump","1","10"],["Row","1","200m"]] },
      { name: "Heavy Carry + Core", focus: "Grip + bracing via loaded carries",
        ex: [["Farmer Carry","4","60 ft"],["Sandbag Carry","4","40 ft"],["Sled Push","4","40 ft"],["Plank","3","60s"],["Russian Twist","3","20"]] },
      { name: "Cardio + Core Mix", focus: "Mixed-modal conditioning + core",
        ex: [["Assault Bike Sprint","5","30s"],["Kettlebell Swing","4","20"],["Row","5","250m"],["Hollow Hold","3","30s"]] },
      { name: "Core Focus", focus: "Dedicated 20-min core session",
        ex: [["Hanging Leg Raise","4","12"],["Cable Crunch","4","15"],["Ab Wheel Rollout","3","10"],["Pallof Press","3","12 each"],["Plank","3","60s"],["Side Plank","3","30s each"]] },
      { name: "Kettlebell Complex", focus: "Full-body kettlebell conditioning",
        ex: [["Kettlebell Swing","5","20"],["Goblet Squat","4","12"],["Kettlebell Clean & Press","4","8 each"],["Kettlebell Snatch","3","10 each"],["Farmer Carry","3","60 ft"]] },
      { name: "Sprint Intervals", focus: "Anaerobic sprint conditioning",
        ex: [["Assault Bike Sprint","8","20s"],["Sled Push","5","40 ft"],["Row Sprint","6","150m"],["Jump Rope","3","60s"],["Plank","3","45s"]] },
      { name: "Ab Circuit", focus: "Bodyweight core circuit · no equipment",
        ex: [["Crunch","4","20"],["Bicycle Crunch","4","20 each"],["Leg Raise","4","15"],["Russian Twist","3","20"],["Plank","3","60s"],["Mountain Climber","3","30s"]] },
    ],
  };

  // ---- Procedural day generator (powers "🎲 Surprise me") ----
  // Builds brand-new day workouts from EXERCISE_LIBRARY (never the curated
  // RECOMMENDED_TEMPLATES set), applying modifier tags via the same tag system
  // used everywhere else — effectively unlimited, fully editable options.
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
    return _pickRange(scheme.reps);  // numeric rep count
  }
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

  function openRecommendedTemplatesModal() {
    const categories = Object.keys(RECOMMENDED_TEMPLATES);
    const SURPRISE = "__surprise__";
    let activeCat = SURPRISE; // open on the shuffle by default
    let surprisePicks = [];

    // "Surprise me" generates brand-new days (never the curated set).
    const rollSurprise = () => {
      surprisePicks = [];
      const seen = new Set();
      let guard = 0;
      while (surprisePicks.length < 5 && guard++ < 60) {
        const day = generateWorkoutDay();
        if (!day || seen.has(day.name)) continue;
        seen.add(day.name);
        surprisePicks.push(day);
      }
    };

    // Copy a day (curated or generated) into the Day Library.
    const addToLibrary = (name, focus, exercises, btn) => {
      const tpl = makeWorkoutTemplate(name, exercises);
      tpl.focus = focus;
      state.trainerData.workoutTemplates.push(tpl);
      saveTrainer();
      renderDayLibrary();
      if (btn) { btn.textContent = "✓ Added"; btn.classList.add("added"); btn.disabled = true; }
    };

    const cardHtml = (t, cat, i) => {
      const exList = t.ex.map((e) => `<strong>${escapeHtml(e[0])}</strong> ${escapeHtml(e[1])}×${escapeHtml(e[2])}`).join(" · ");
      return `
        <div class="rec-card">
          <div class="rec-card-head">
            <div>
              <h5>${escapeHtml(t.name)}</h5>
              <div class="rec-meta">${escapeHtml(t.focus)} · ${t.ex.length} exercise${t.ex.length === 1 ? "" : "s"}</div>
            </div>
            <button class="rec-add" data-cat="${escapeHtml(cat)}" data-idx="${i}">+ Add</button>
          </div>
          <div class="rec-ex-list">${exList}</div>
        </div>`;
    };

    // Card for a freshly generated day — shows modifier-tag chips inline.
    const genCardHtml = (day, idx) => {
      const exList = day.exercises.map((e) => {
        const chips = (e.modifiers && e.modifiers.length)
          ? " " + orderedModifiers(e).map((tag) => { const { color, bg } = tagColor(tag); return `<span class="mod-chip" style="--mc:${color};--mb:${bg}">${escapeHtml(tag)}</span>`; }).join("")
          : "";
        const fin = finisherSummary(e);
        return `<span class="rec-ex-item"><strong>${escapeHtml(e.name)}</strong> ${escapeHtml(e.sets)}×${escapeHtml(e.reps)}${fin ? ` <span class="rec-fin">${escapeHtml(fin)}</span>` : ""}${chips}</span>`;
      }).join(" · ");
      return `
        <div class="rec-card">
          <div class="rec-card-head">
            <div>
              <h5>${escapeHtml(day.name)} <span class="rec-gen-badge">generated</span></h5>
              <div class="rec-meta">${escapeHtml(day.focus)} · ${day.exercises.length} exercise${day.exercises.length === 1 ? "" : "s"}${day.exercises.some((e) => e.supersetId) ? ` · <span class="rec-fin">🔗 superset</span>` : ""}</div>
            </div>
            <button class="rec-add" data-gen="${idx}">+ Add</button>
          </div>
          <div class="rec-ex-list">${exList}</div>
        </div>`;
    };

    const renderBody = () => {
      const chips = [
        `<button class="rec-cat-chip${activeCat === SURPRISE ? " active" : ""}" data-cat="${SURPRISE}">🎲 Surprise me</button>`,
        ...categories.map((c) => `<button class="rec-cat-chip${c === activeCat ? " active" : ""}" data-cat="${escapeHtml(c)}">${escapeHtml(c)}</button>`),
      ].join("");
      let cards, hint;
      if (activeCat === SURPRISE) {
        if (!surprisePicks.length) rollSurprise();
        cards = surprisePicks.map((d, i) => genCardHtml(d, i)).join("");
        hint = `5 freshly generated workouts. Tap <strong>+ Add</strong> on any, or <button class="rec-reroll" type="button">🎲 Reroll</button> for a whole new batch.
          <div class="rec-surprise-actions"><button class="rec-add-all" type="button">➕ Add all 5 to library</button></div>`;
      } else {
        cards = RECOMMENDED_TEMPLATES[activeCat].map((t, i) => cardHtml(t, activeCat, i)).join("");
        hint = `Tap <strong>+ Add</strong> to copy a workout into your library. Edit it from there anytime.`;
      }
      return `
        <p class="muted" style="margin-top:-0.3em">${hint}</p>
        <div class="rec-cat-chips">${chips}</div>
        <div class="rec-list">${cards}</div>`;
    };
    openModal({
      title: "Recommended workouts",
      body: renderBody(),
      actions: [{ label: "Done", className: "btn btn-ghost", onClick: closeModal }],
    });
    const wireBody = () => {
      $("#modal-body").querySelectorAll(".rec-cat-chip").forEach((chip) => {
        chip.addEventListener("click", () => {
          activeCat = chip.dataset.cat;
          if (activeCat === SURPRISE) rollSurprise();
          $("#modal-body").innerHTML = renderBody();
          wireBody();
        });
      });
      $("#modal-body").querySelector(".rec-reroll")?.addEventListener("click", () => {
        rollSurprise();
        $("#modal-body").innerHTML = renderBody();
        wireBody();
      });
      // Curated cards (category view): look up by cat + idx.
      $("#modal-body").querySelectorAll(".rec-add[data-cat]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const t = RECOMMENDED_TEMPLATES[btn.dataset.cat]?.[Number(btn.dataset.idx)];
          if (!t) return;
          const exercises = t.ex.map(([name, sets, reps]) => ({ name, sets, currentReps: reps, notes: t.focus }));
          addToLibrary(t.name, t.focus, exercises, btn);
          toast(`Added "${t.name}" to library 🏆`);
        });
      });
      // Generated cards (Surprise me): pull the day object from surprisePicks.
      const genExercises = (day) => day.exercises.map((e) => ({
        name: e.name, sets: e.sets, currentReps: e.reps, notes: day.focus, modifiers: [...(e.modifiers || [])],
        ...(e.currentWeight ? { currentWeight: e.currentWeight } : {}),
        ...(e.progression ? { progression: { ...e.progression } } : {}),
        ...(e.burnout ? { burnout: e.burnout } : {}),
        ...(e.dropset ? { dropset: e.dropset } : {}),
        ...(e.supersetId ? { supersetId: e.supersetId } : {}),
      }));
      $("#modal-body").querySelectorAll(".rec-add[data-gen]").forEach((btn) => {
        btn.addEventListener("click", () => {
          const day = surprisePicks[Number(btn.dataset.gen)];
          if (!day) return;
          addToLibrary(day.name, day.focus, genExercises(day), btn);
          toast(`Added "${day.name}" to library 🏆`);
        });
      });
      // "Add all 5" — copy the whole generated batch in one tap.
      $("#modal-body").querySelector(".rec-add-all")?.addEventListener("click", (e) => {
        surprisePicks.forEach((day) => addToLibrary(day.name, day.focus, genExercises(day), null));
        $("#modal-body").querySelectorAll(".rec-add[data-gen]").forEach((b) => { b.textContent = "✓ Added"; b.classList.add("added"); b.disabled = true; });
        e.currentTarget.textContent = "✓ Added all 5";
        e.currentTarget.disabled = true;
        toast(`Added ${surprisePicks.length} days to library 🏆`);
      });
    };
    wireBody();
  }

  // Day Library — reusable single-day templates (state.trainerData.workoutTemplates).
  // Reached from the Programs page; days are built here and imported into weeks
  // via the "📥 Library" button (openImportDayModal).
  function renderDayLibrary() {
    switchCoachView("day-library");
    updateHeaderBreadcrumb(null);
    const grid = $("#day-lib-grid");
    const empty = $("#day-lib-empty");
    if (!grid) return;
    grid.innerHTML = "";
    const templates = [...(state.trainerData.workoutTemplates || [])].sort((a, b) => a.name.localeCompare(b.name));
    if (!templates.length) { show(empty); hide(grid); return; }
    hide(empty); show(grid);
    templates.forEach((t) => {
      const exCount = t.exercises?.length || 0;
      const row = document.createElement("div");
      row.className = "coach-row";

      const icon = document.createElement("div");
      icon.className = "coach-row-icon";
      icon.textContent = workoutIconFor(t.name);

      const main = document.createElement("div");
      main.className = "coach-row-main";
      const nameEl = document.createElement("div");
      nameEl.className = "coach-row-name";
      nameEl.textContent = t.name;
      const sub = document.createElement("div");
      sub.className = "coach-row-sub";
      const subParts = [];
      if (t.focus) subParts.push(t.focus);
      subParts.push(`${exCount} exercise${exCount === 1 ? "" : "s"}`);
      if (t.notes) subParts.push("📝 notes");
      sub.textContent = subParts.join(" · ");
      main.appendChild(nameEl);
      main.appendChild(sub);

      const actions = document.createElement("div");
      actions.className = "coach-row-actions";
      const deleteBtn = document.createElement("button");
      deleteBtn.className = "btn-delete-mini";
      deleteBtn.title = "Delete day";
      deleteBtn.textContent = "×";
      deleteBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        if (!window.confirm(`Delete day template "${t.name}"?`)) return;
        state.trainerData.workoutTemplates =
          state.trainerData.workoutTemplates.filter((x) => x.id !== t.id);
        saveTrainer();
        renderDayLibrary();
        toast("Day template deleted");
      });
      actions.appendChild(deleteBtn);

      row.appendChild(icon);
      row.appendChild(main);
      row.appendChild(actions);
      row.addEventListener("click", () => openDayEditor(t));
      grid.appendChild(row);
    });
  }

  // ---- Single-day editor (full page — same builder the program editor uses) ----
  // We edit a deep copy so "← Back" discards changes; the draft is a workout
  // template, which is shape-compatible with a program "day" (name/icon/
  // exercises), so we mount it straight into renderDayContent + the library.
  let _dayEditorDraft = null;
  let _dayEditorEditingId = null;

  function openDayEditor(template) {
    _dayEditorEditingId = template ? template.id : null;
    _dayEditorDraft = template ? JSON.parse(JSON.stringify(template)) : makeWorkoutTemplate("");
    if (!template) _dayEditorDraft.name = "";
    switchCoachView("day-editor");
    renderDayEditor();
    setTimeout(() => $("#day-editor-day .day-name-compact")?.focus(), 60);
  }

  function renderDayEditor() {
    const d = _dayEditorDraft;
    if (!d) return;
    const title = $("#day-editor-title");
    if (title) title.textContent = _dayEditorEditingId ? "Edit day" : "New day";
    const focusI = $("#day-editor-focus");
    const notesI = $("#day-editor-notes");
    if (focusI) { focusI.value = d.focus || ""; focusI.oninput = () => { d.focus = focusI.value; }; }
    if (notesI) { notesI.value = d.notes || ""; notesI.oninput = () => { d.notes = notesI.value; }; }
    const host = $("#day-editor-day");
    if (!host) return;
    host.innerHTML = "";
    // Synthetic single-day "week" so renderDayContent's shared machinery works;
    // hideDelete drops the per-day delete button (there's only one day here).
    const synthWeek = { id: "_daytpl", days: [d] };
    host.appendChild(renderDayContent(synthWeek, d, renderDayEditor, { hideDelete: true }));
  }

  function saveDayEditor() {
    const d = _dayEditorDraft;
    if (!d) return;
    const name = (d.name || "").trim();
    if (!name) { toast("Give the day a name"); $("#day-editor-day .day-name-compact")?.focus(); return; }
    d.name = name;
    d.focus = ($("#day-editor-focus")?.value || "").trim();
    d.notes = ($("#day-editor-notes")?.value || "").trim();
    // Strip empty exercises (no name AND no notes).
    d.exercises = d.exercises.filter((ex) => (ex.name || "").trim() || (ex.notes || "").trim());
    if (!d.exercises.length) { toast("Add at least one exercise"); return; }
    d.updatedAt = Date.now();
    if (_dayEditorEditingId) {
      state.trainerData.workoutTemplates = state.trainerData.workoutTemplates.map((t) =>
        t.id === d.id ? d : t);
    } else {
      state.trainerData.workoutTemplates.push(d);
    }
    saveTrainer();
    const wasEditing = !!_dayEditorEditingId;
    _dayEditorDraft = null; _dayEditorEditingId = null;
    renderDayLibrary();
    toast(wasEditing ? "Day updated" : "Day created 📚");
  }

  function openLoadTemplateModal(week, day) {
    const templates = state.trainerData.workoutTemplates || [];
    if (!templates.length) {
      toast("No templates yet. Create one in Workout Library");
      return;
    }
    const list = templates
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((t) => {
        const icon = workoutIconFor(t.name);
        return `
          <button class="video-pick-btn" data-tpl="${t.id}" type="button">
            <span class="video-pick-icon">${icon}</span>
            <strong>${escapeHtml(t.name)}</strong>
            ${t.focus ? `<span class="muted" style="margin-left:0.4em">· ${escapeHtml(t.focus)}</span>` : ""}
            <span class="meta-pill" style="margin-left:auto">${t.exercises.length} ex</span>
          </button>`;
      })
      .join("");
    openModal({
      title: `Load template into "${day.name}"`,
      body: `
        <p class="muted" style="margin-top:-0.4em">This replaces the day's exercises with the template. Day name and focus also update.</p>
        <div class="video-pick-list">${list}</div>
      `,
      actions: [{ label: "Cancel", className: "btn btn-ghost", onClick: closeModal }],
    });
    document.querySelectorAll(".video-pick-btn[data-tpl]").forEach((b) => {
      b.addEventListener("click", () => {
        const t = templates.find((x) => x.id === b.dataset.tpl);
        if (!t) return;
        // Replace day contents — keep day id (so logs survive), refresh exercises with new ids
        day.name = t.name;
        if (t.focus && !week.focus) week.focus = t.focus;
        day.exercises = t.exercises.map((e) => ({ ...makeExercise(), ...e, id: uid() }));
        saveTrainer();
        closeModal();
        renderWeeks();
        // Cloud sync the updated athlete
        const c = currentClient();
        if (window.Cloud?.enabled && c && state.trainerData.coachId) {
          window.Cloud.upsertAthlete(c, state.trainerData.coachId);
        }
        toast(`Loaded "${t.name}"`);
      });
    });
  }

  // Import a saved Day Template from the Workout Library into a week as a NEW
  // day (as opposed to openLoadTemplateModal, which replaces an existing day).
  function openImportDayModal(week, rerenderFn) {
    const templates = state.trainerData.workoutTemplates || [];
    if (!templates.length) {
      toast("No day templates yet. Build one in Workout Library");
      return;
    }
    const list = templates
      .slice()
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((t) => {
        const icon = workoutIconFor(t.name);
        return `
          <button class="video-pick-btn" data-tpl="${t.id}" type="button">
            <span class="video-pick-icon">${icon}</span>
            <strong>${escapeHtml(t.name)}</strong>
            ${t.focus ? `<span class="muted" style="margin-left:0.4em">· ${escapeHtml(t.focus)}</span>` : ""}
            <span class="meta-pill" style="margin-left:auto">${(t.exercises || []).length} ex</span>
          </button>`;
      })
      .join("");
    openModal({
      title: `Import a day into ${escapeHtml(week.label)}`,
      body: `
        <p class="muted" style="margin-top:-0.4em">Adds the selected day from your library as a new day in this week. The original template is untouched.</p>
        <div class="video-pick-list">${list}</div>
      `,
      actions: [{ label: "Cancel", className: "btn btn-ghost", onClick: closeModal }],
    });
    document.querySelectorAll(".video-pick-btn[data-tpl]").forEach((b) => {
      b.addEventListener("click", () => {
        const t = templates.find((x) => x.id === b.dataset.tpl);
        if (!t) return;
        const day = makeDay(week.days.length + 1, t.name);
        day.exercises = (t.exercises || []).map((e) => ({ ...makeExercise(), ...e, id: uid() }));
        if (t.focus && !week.focus) week.focus = t.focus;
        week.days.push(day);
        week._activeDayIdx = week.days.length - 1;
        saveTrainer();
        closeModal();
        rerenderFn();
        // Cloud sync the updated athlete (skip in the program-template editor).
        const c = currentClient();
        if (window.Cloud?.enabled && c && !_programEditorId && state.trainerData.coachId) {
          window.Cloud.upsertAthlete(c, state.trainerData.coachId);
        }
        toast(`Added "${t.name}"`);
      });
    });
  }

  function deleteClientPrompt() {
    const c = currentClient(); if (!c) return;
    if (!window.confirm(`Delete ${c.name}? Removes the athlete and their entire program from this device and the cloud.`)) return;
    const cloudId = c.id;
    state.trainerData.clients = state.trainerData.clients.filter((x) => x.id !== c.id);
    saveTrainer();
    // Cloud: delete athlete (CASCADE removes athlete_profiles + progress).
    if (window.Cloud?.enabled) window.Cloud.deleteAthlete(cloudId);
    renderDashboard();
    toast("Athlete deleted");
  }

  // -------- Exercise Library --------
  const EXERCISE_LIBRARY = [
    { cat: "Chest",      ex: ["Bench Press","Incline Bench Press","Decline Bench Press","Fly","Cable Fly","Push-Up","Dips","Pec Deck","Pullover","Machine Chest Press","Incline Dumbbell Press","Floor Press","Landmine Press","Svend Press"] },
    { cat: "Back",       ex: ["Pull-Up","Chin-Up","Row","Pendlay Row","Lat Pulldown","T-Bar Row","Chest-Supported Row","Straight-Arm Pulldown","Seated Cable Row","Single-Arm Row","Meadows Row","Rack Pull","Inverted Row","Wide-Grip Pulldown","Back Extension"] },
    { cat: "Quads",      ex: ["Back Squat","Front Squat","Leg Press","Hack Squat","Trap Bar Deadlift","Bulgarian Split Squat","Split Squat","Lunge","Walking Lunge","Leg Extension","Step-Up","Goblet Squat","Box Squat","Reverse Lunge","Sissy Squat","Pause Squat","Pendulum Squat","Zercher Squat"] },
    { cat: "Hamstrings", ex: ["Deadlift","Romanian Deadlift","Stiff-Leg Deadlift","Lying Leg Curl","Seated Leg Curl","Leg Curl","Nordic Curl","Good Morning","Glute-Ham Raise","Single-Leg RDL","Cable Pull-Through","Kettlebell Swing"] },
    { cat: "Glutes",     ex: ["Hip Thrust","Glute Bridge","Kickback","Sumo Deadlift","Abductor","Lateral Walk","Donkey Kick","Pull-Through","Frog Pump","B-Stance Hip Thrust","Curtsy Lunge","Cable Kickback"] },
    { cat: "Adductors",  ex: ["Hip Adduction","Copenhagen Plank","Lateral Lunge","Cossack Squat","Sumo Squat","Side-Lying Adduction","Adductor Machine"] },
    { cat: "Abductors",  ex: ["Hip Abduction"] },
    { cat: "Shoulders",  ex: ["Overhead Press","Overhead Raise","Lateral Raise","Front Raise","Rear Delt Fly","Arnold Press","Upright Row","Face Pull","Shrug","Seated Dumbbell Press","Cable Lateral Raise","Reverse Pec Deck","Push Press","Z Press","Landmine Press"] },
    { cat: "Biceps",     ex: ["Curl","Hammer Curl","Preacher Curl","Concentration Curl","EZ-Bar Curl","Spider Curl","Incline Curl","Cable Curl","Bayesian Curl","Reverse Curl","Zottman Curl","Drag Curl"] },
    { cat: "Triceps",    ex: ["Tricep Pushdown","Skull Crusher","Close-Grip Bench Press","Overhead Tricep Extension","Tricep Dips","Diamond Push-Up","Kickback","Rope Pushdown","JM Press","Tate Press","Cable Overhead Extension"] },
    { cat: "Core",       ex: ["Plank","Side Plank","Crunch","Cable Crunch","Bicycle Crunch","Russian Twist","Leg Raise","Hanging Leg Raise","Ab Wheel Rollout","Dead Bug","Pallof Press","Dragon Flag","Hollow Hold","V-Up","Toes-to-Bar","Reverse Crunch","Sit-Up","Windshield Wiper","Bear Crawl","Crab Crawl","Leopard Crawl","Lizard Crawl","Spiderman Crawl","Inchworm"] },
    { cat: "Calves",     ex: ["Calf Raise","Donkey Calf Raise","Leg Press Calf Raise","Seated Calf Raise","Standing Calf Raise","Single-Leg Calf Raise","Tibialis Raise"] },
    { cat: "Carries",    ex: ["Farmer's Carry","Suitcase Carry","Overhead Carry","Rack Carry","Zercher Carry","Trap Bar Carry","Bear Hug Carry","Bottoms-Up Carry","Waiter Walk","Sandbag Carry","Yoke Walk","Front Rack Carry"] },
    { cat: "Cardio",     ex: ["Treadmill Run","Stationary Bike","Rowing","Jump Rope","Sled Push","Battle Ropes","Farmer's Walk","Assault Bike","Stair Climber","Sprint Intervals","Incline Walk","Ski Erg","Box Jump","Burpee","High Knees"] },
    { cat: "Bodyweight", ex: ["Superman"] },
    { cat: "Speed/Agility", ex: ["Ladder Two-Feet Run","Ladder Icky Shuffle","Ladder In-In-Out-Out","Ladder Lateral Shuffle","Ladder Ali Shuffle","Ladder Crossover","Ladder Hopscotch","Ladder Single-Leg Hop","Ladder Snake","A-Skip","B-Skip","Carioca","5-10-5 Pro Agility","T-Drill","Box Drill","L-Drill","Cone Weave","Shuttle Run","Lateral Bound","Skater Bound","Broad Jump Series","Dot Drill","Mini-Hurdle Hops","Wall Drive","Falling Start","Acceleration Sprint","Flying Sprint","Backpedal Drill","Resisted Sprint Drill","Reaction Sprint"] },
    { cat: "Mobility & Stretching", ex: ["Couch Stretch","90/90 Hip Stretch","World's Greatest Stretch","Cat-Cow","Hip Flexor Stretch","Hamstring Stretch","Pigeon Stretch","Thoracic Rotation","Child's Pose","Downward Dog","Ankle Dorsiflexion","Shoulder Dislocates","Doorway Pec Stretch","Deep Squat Hold","Cossack Stretch","Seated Forward Fold","Butterfly Stretch","Standing Quad Stretch","Wrist Flexor Stretch","Neck Stretch"] },
  ];
  // Categories whose exercises are prescribed as holds-for-time (sets × seconds),
  // not weight × reps. Exercises added from these get kind:"mobility".
  const MOBILITY_CATS = ["Mobility & Stretching"];
  const MOBILITY_NAMES = new Set(
    EXERCISE_LIBRARY.filter((c) => MOBILITY_CATS.includes(c.cat)).flatMap((c) => c.ex)
  );
  function isMobilityName(name) {
    if (MOBILITY_NAMES.has(name)) return true;
    // Custom exercises filed under a mobility category are holds too.
    return customExerciseList().some((c) => c.name === name && MOBILITY_CATS.includes(c.cat));
  }
  // Speed/agility drills (ladder work, sprints, cone drills) are prescribed the
  // same way — rounds × seconds, no weight — so they reuse the kind:"mobility"
  // card machinery, but render in their own ⚡ section (not under Stretching).
  const SPEED_CATS = ["Speed/Agility"];
  const SPEED_NAMES = new Set(
    EXERCISE_LIBRARY.filter((c) => SPEED_CATS.includes(c.cat)).flatMap((c) => c.ex)
  );
  function isSpeedName(name) {
    if (SPEED_NAMES.has(name)) return true;
    return customExerciseList().some((c) => c.name === name && SPEED_CATS.includes(c.cat));
  }
  // Either flavour of hold-for-time card (stretch or drill): sets × seconds, no
  // weight. Both carry kind:"mobility" so all the no-weight/PR-exclusion
  // plumbing applies; use this wherever that card behaviour is what matters.
  function isHoldName(name) { return isMobilityName(name) || isSpeedName(name); }
  const HOLD_CATS = MOBILITY_CATS.concat(SPEED_CATS);
  const HOLD_NAMES = new Set([...MOBILITY_NAMES, ...SPEED_NAMES]);
  // Hold-duration options (seconds) for the coach's mobility prescription picker.
  const HOLD_SEC_VALUES = ["10", "15", "20", "30", "45", "60", "90", "120"];
  // Categories whose exercises are weight × time (seconds) — see exIsTimed().
  const TIMED_CATS = ["Carries"];
  const CARRY_NAMES = new Set(
    EXERCISE_LIBRARY.filter((c) => TIMED_CATS.includes(c.cat)).flatMap((c) => c.ex)
  );
  function isCarryName(name) {
    if (!name) return false;
    if (CARRY_NAMES.has(name)) return true;
    // Any name that says "carry" counts (covers coach-typed variants on both
    // the coach and athlete side, where the custom list isn't available).
    if (/\bcarr(y|ies)\b/i.test(name)) return true;
    return customExerciseList().some((c) => c.name === name && TIMED_CATS.includes(c.cat));
  }
  // Time options (seconds) for the coach's carry prescription picker.
  const CARRY_SEC_VALUES = ["10", "15", "20", "30", "40", "45", "60", "90", "120"];

  // Flat, de-duped, alphabetised list of every library exercise — feeds the
  // native <datalist> that powers the type-to-add field on each day.
  const ALL_EXERCISE_NAMES = [...new Set(EXERCISE_LIBRARY.flatMap((c) => c.ex))]
    .sort((a, b) => a.localeCompare(b));

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
      accessories: ["Rack Pull", "Farmer's Carry", "Upright Row", "Rear Delt Fly"],
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
    biceps: ["Biceps brachii — long head", "Biceps brachii — short head", "Brachialis", "Coracobrachialis"],
    forearms: ["Brachioradialis", "Flexor carpi radialis", "Flexor carpi ulnaris", "Extensor carpi radialis", "Extensor carpi ulnaris", "Flexor digitorum", "Extensor digitorum", "Pronator teres", "Supinator"],
    core: ["Rectus abdominis", "Transverse abdominis"],
    obliques: ["External oblique", "Internal oblique"],
    quads: ["Rectus femoris", "Vastus lateralis", "Vastus medialis", "Vastus intermedius"],
    adductors: ["Adductor magnus", "Adductor longus", "Adductor brevis", "Gracilis", "Pectineus"],
    calves: ["Gastrocnemius — medial head", "Gastrocnemius — lateral head", "Soleus", "Tibialis anterior", "Tibialis posterior", "Fibularis (peroneus)"],
    "delts-rear": ["Posterior deltoid (rear head)"],
    lats: ["Latissimus dorsi", "Teres major"],
    rhomboids: ["Rhomboid major", "Rhomboid minor", "Trapezius — middle fibers", "Trapezius — lower fibers"],
    traps: ["Trapezius — upper fibers", "Levator scapulae"],
    triceps: ["Triceps brachii — long head", "Triceps brachii — lateral head", "Triceps brachii — medial head", "Anconeus"],
    lowerback: ["Erector spinae — iliocostalis", "Erector spinae — longissimus", "Erector spinae — spinalis", "Multifidus", "Quadratus lumborum"],
    glutes: ["Gluteus maximus", "Gluteus medius", "Gluteus minimus", "Tensor fasciae latae"],
    hamstrings: ["Biceps femoris — long head", "Biceps femoris — short head", "Semitendinosus", "Semimembranosus"],
    abductors: ["Gluteus medius", "Gluteus minimus", "Tensor fasciae latae"],
  };
  // Which groups list in each view's legend (region "both" shows in both).
  const ANATOMY_VIEW_GROUPS = {
    front: ANATOMY_GROUPS.filter((g) => g.region === "front" || g.region === "both").map((g) => g.id),
    back: ANATOMY_GROUPS.filter((g) => g.region === "back" || g.region === "both").map((g) => g.id),
  };

  // Muscle-map SVG paths adapted from "Body Muscles" by Ivan Vulovic
  // (github.com/vulovix/body-muscles), Apache-2.0. Grouped many fine-grained
  // muscle regions into Stone Dragon's coarser groups; non-muscle parts (head,
  // hands, feet, joints, spine) become the non-interactive body backdrop.
  const ANATOMY_FIG = {
    front: {
      viewBox: "0 0 35 93",
      body: [
      "m 11.671635,6.3585449 -0.0482,-2.59085 4.20648,-2.46806 4.42769,2.95361 -0.0405,1.94408 0.24197,-3.34467 -2.03129,-2.31103004 -2.84508,-0.51629 -2.20423,0.52915 -1.9363,2.63077004 z",
      "m 19.748825,6.7034949 0.0203,-2.20747 -3.96689,-2.7637 -3.74099,2.23559 -0.006,2.63528 -0.60741,0.0403 0.27408,1.82447 0.97635,0.33932 0.44244,2.1802901 1.82222,2.06556 2.03518,-0.0607 1.79223,-1.94408 0.35957,-2.2406601 0.97616,-0.33932 0.25159,-1.78416 z",
      "m 13.304665,11.910505 1.64975,2.35202 0.74426,2.62159 -1.73486,-1.38354 -0.86649,-2.97104 z",
      "m 18.385135,11.910505 -1.64975,2.35202 -0.74538,2.62234 1.73486,-1.38354 0.86649,-2.97104 z",
      "m 17.255895,87.868445 0.1243,3.45228 0.28983,1.20638 h 0.87136 l 0.24897,-0.83181 0.29058,-0.0416 -0.0624,0.83181 1.09914,-0.33332 0.29058,-0.16629 1.24444,-0.27033 0.0416,-0.97748 -1.20319,-2.03743 -0.82974,-1.0399 -2.03294,-0.83181 z",
      "m 21.404635,64.784375 0.1243,1.12295 -0.87118,1.08171 -0.29058,1.70599 -0.58116,0.24933 -0.49774,-2.57866 -0.33182,-0.91486 0.29058,-0.58247 z m -3.85853,0.0832 0.6224,1.74685 1.3273,2.57867 -0.33182,2.37095 -0.95423,-2.66209 -0.78738,-1.49734 z m 4.97811,-2.37039 -0.95423,5.11609 0.62241,-0.33295 0.49773,1.66381 z",
      "m 14.433335,87.868265 -0.12448,3.45228 -0.29058,1.20637 h -0.87118 l -0.24877,-0.83181 -0.29059,-0.0416 0.0623,0.83181 -1.09934,-0.33333 -0.29058,-0.16629 -1.2448,-0.27033 -0.0412,-0.97747 1.2031899,-2.03781 0.82975,-1.04009 2.03294,-0.83181 z",
      "m 10.284405,64.784375 -0.12448,1.12295 0.87118,1.08171 0.29058,1.70599 0.58116,0.24933 0.49774,-2.57866 0.33182,-0.91486 -0.29058,-0.58247 z m 3.85854,0.0832 -0.62241,1.74685 -1.32767,2.57867 0.33182,2.37095 0.95423,-2.66209 0.78832,-1.4964 z m -4.9786799,-2.37058 0.9542299,5.11609 -0.6223999,-0.33313 -0.49793,1.6638 z",
      "m 3.2054751,27.370125 0.005,3.09419 -0.57959,1.91184 -0.54539,-2.41185 z",
      "m 4.3904451,43.563145 -1.5198,0.0506 -0.76631,-0.67112 -1.21261996,2.15767 -0.86245,3.32873 0.49386,0.22113 0.59814996,-2.20238 0.50016,0.25356 -0.35639,2.49422 0.62382,0.24345 0.41402,-2.49194 0.55839,0.17851 -0.2262,2.76603 0.76938,0.32268 0.25788,-2.86764 0.4578,-0.0181 0.16611,2.65239 0.65997,0.2633 0.0712,-4.56643 0.34158,-0.19428 1.35316,1.68367 0.32832,-0.34354 -0.72644,-2.0551 z",
      "m 28.325215,27.370125 -0.005,3.09419 0.57959,1.91184 0.54538,-2.41185 z",
      "m 27.140245,43.563145 1.5198,0.0506 0.76631,-0.67111 1.21262,2.15766 0.86245,3.32873 -0.49386,0.22113 -0.59815,-2.20238 -0.50016,0.25356 0.35639,2.49422 -0.62382,0.24345 -0.41402,-2.49194 -0.55839,0.17851 0.2262,2.76603 -0.76938,0.32268 -0.25788,-2.86764 -0.4578,-0.0181 -0.16611,2.6524 -0.65997,0.26329 -0.0712,-4.56643 -0.34158,-0.19428 -1.35316,1.68368 -0.32832,-0.34355 0.72644,-2.0551 z"
      ],
      zones: [
      { m: "delts-front", d: "m 19.047795,13.248365 3.55748,1.97916 0.72653,-0.35074 z m -0.107,0.43288 -0.37119,1.73073 2.1846,0.53561 1.40116,-0.49436 z" },
      { m: "delts-side", d: "m 22.922305,15.657195 0.75814,-0.41 2.40806,1.66799 1.17364,1.50707 0.62662,1.5626 -0.0464,3.70194 -1.3284,-1.72153 0.0407,-2.59376 -0.48842,-0.50049 c 0,0 -3.09778,-3.19058 -3.14371,-3.21401 z m -0.2409,0.10873 c -0.001,0.0525 3.32987,3.54733 3.32987,3.54733 l 0.10067,3.10396 -1.15426,-1.97782 -2.22547,-0.94804 -1.56576,-2.88481 z" },
      { m: "delts-front", d: "m 12.624785,13.248365 -3.5574599,1.97916 -0.72653,-0.35074 z m 0.107,0.43288 0.37119,1.73073 -2.18459,0.53561 -1.4011499,-0.49436 z" },
      { m: "delts-side", d: "m 8.7502951,15.657195 -0.75814,-0.41 -2.40806,1.66799 -1.17364,1.50707 -0.62662,1.56259 0.0464,3.70195 1.3284,-1.72153 -0.0407,-2.59376 0.48843,-0.5005 c 0,0 3.09777,-3.19057 3.1437,-3.214 z m 0.2409,0.10873 c 0.002,0.0525 -3.32987,3.54733 -3.32987,3.54733 l -0.10067,3.10396 1.15426,-1.97782 2.22547,-0.94804 1.5657499,-2.88481 z" },
      { m: "biceps", d: "m 27.621665,30.814715 -0.33838,1.70499 -1.81932,-2.54418 -0.6629,-1.26895 z m -2.85271,-2.6096 c -0.0259,-0.0144 -0.0536,-0.0254 -0.0824,-0.0324 l -1.48333,-4.95503 1.00456,-2.08428 1.65511,1.74532 2.23034,6.67667 0.0415,0.93739 c -1.06528,-0.84215 -2.18962,-1.60679 -3.36434,-2.28803 z m 1.6945,-5.75654 1.64893,6.43421 -0.36469,-4.92266 z" },
      { m: "forearms", d: "m 26.955425,32.969125 1.30083,10.28927 -1.10778,0.01 -1.89387,-7.99609 0.19174,-4.53719 z m 1.21978,-1.94971 -0.58729,2.58635 1.11876,9.15614 0.55849,-0.21663 0.2304,-6.77018 z" },
      { m: "biceps", d: "m 4.0746451,30.814715 0.33838,1.70499 1.81931,-2.54418 0.66289,-1.26895 z m 2.8527,-2.6096 c 0.0259,-0.0144 0.0536,-0.0254 0.0824,-0.0324 l 1.48332,-4.95503 -1.00455,-2.08428 -1.65509,1.74532 -2.23034,6.67667 -0.0415,0.93739 c 1.06528,-0.84215 2.18961,-1.60679 3.36433,-2.28803 z m -1.6945,-5.75654 -1.64891,6.43421 0.36468,-4.92266 z" },
      { m: "forearms", d: "m 4.5752651,32.969125 -1.30083,10.28927 1.10778,0.01 1.89387,-7.99609 -0.19174,-4.53719 z m -1.21978,-1.94971 0.58728,2.58635 -1.11875,9.15614 -0.55849,-0.21663 -0.2304,-6.77018 z" },
      { m: "chest", d: "m 20.337455,17.085495 1.72942,3.09103 1.890,0.94 -0.5,0.3 -6.8, -2.1 z" },
      { m: "chest", d: "m 16.66,19.72 6.8,2.1 -0.65,0.5 -0.90604,2.63773 -2.09968,0.86537 -3.34524,-1.655 0.2,-3.8 z" },
      { m: "chest", d: "m 11.351215,17.085495 -1.7294199,3.09103 -1.890,0.94 0.5,0.3 6.8,-2.1 z" },
      { m: "chest", d: "m 15.03,19.72 -6.8,2.1 0.65,0.5 0.90586,2.63773 2.0996699,0.86537 3.34636,-1.655 -0.2,-3.8 z" },
      { m: "core", d: "m 19.641935,34.707615 1.81341,-1.36479 0.15748,1.83347 1.28642,2.37338 -1.98044,2.73652 -1.03109,0.16554 -0.37026,-3.88816 z" },
      { m: "obliques", d: "M 19.289,26.152 l -3.11202 -1.40604 0.0937 2.27965 2.80119 1.43603 z M 21.224,27.820 l -1.29355 0.7212 0.14997 -1.70898 z M 20.171,26.183 l 2.47968 -1.03241 -0.9336 2.52093 z M 21.702,27.921 l -1.69005 1.03372 -0.28871 2.0678 1.64975 -1.07533 z" },
      { m: "obliques", d: "M 18.791,29.025 l -0.0622 1.62387 -2.30308 -0.49961 -0.12448 -2.21722 z M 18.635,31.429 l 0.0311 1.99844 -2.20953 0.59391 -0.0311 -3.1227 z M 21.290,30.444 l -1.48383 1.03372 -0.20622 2.10905 1.64862 -1.32355 z" },
      { m: "core", d: "m 12.045985,34.707615 -1.81341,-1.36479 -0.15748,1.83347 -1.2856799,2.37432 1.9804499,2.73595 1.03109,0.16554 0.37119,-3.88721 z" },
      { m: "core", d: "m 15.636055,44.919735 -0.60647,-5.91209 -0.015,-3.84879 -2.18479,-1.07533 -0.24746,7.03017 z" },
      { m: "core", d: "m 16.051865,44.919165 0.60628,-5.91209 0.0154,-3.84915 2.18404,-1.07515 0.24746,7.03017 z" },
      { m: "obliques", d: "m 12.399365,26.152365 3.11202,-1.40603 -0.0937,2.27965 -2.80138,1.4364 z m -1.93508,1.6685 1.29355,0.72139 -0.14997,-1.70899 z m 1.05303,-1.637 -2.4793099,-1.03259 0.93361,2.52148 z m -1.5316399,1.73729 1.6900499,1.03372 0.28871,2.06743 -1.64881,-1.07515 z" },
      { m: "obliques", d: "M 12.897,29.025 l 0.0623 1.62387 2.30327 -0.49961 0.12448 -2.21703 z M 13.053,31.430 l -0.0309 1.99844 2.20973 0.59353 0.0311 -3.1227 z M 10.398,30.445 l 1.48384 1.0339 0.20622 2.10905 -1.64975 -1.32355 z" },
      { m: "adductors", d: "m 14.404465,45.040075 0.0221,-0.0277 -0.14866,-0.37945 -3.10172,-3.40449 -0.23283,-0.0825 2.05918,5.32009 z m -1.17263,2.01833 1.27705,3.29948 0.42631,-4.04862 -0.25196,-0.64303 z" },
      { m: "adductors", d: "m 17.284025,45.040455 -0.0221,-0.0281 0.14867,-0.37926 3.10171,-3.40449 0.23246,-0.0825 -2.05843,5.3199 z m 1.17263,2.01795 -1.27706,3.29948 -0.42631,-4.04843 0.25197,-0.64303 z" },
      { m: "quads", d: "m 23.419015,50.399125 -0.15504,4.75091 -2.40263,6.60949 0.7362,1.90021 2.36401,-8.34435 z m -0.58154,-11.60825 -0.15485,4.00722 1.31793,7.93154 0.61977,-6.40308 z m -0.38731,5.12268 -2.75152,6.07258 -0.62015,4.87425 1.16232,6.85771 2.51886,-6.98144 0.15504,-7.18764 z" },
      { m: "adductors", d: "m 22.063225,39.369605 v 4.21363 l -2.94574,5.82511 -1.86027,5.78349 0.19365,-4.0072 z m -3.24944,13.42596 -0.0649,0.15467 -1.21294,2.90207 0.78325,7.18803 1.23619,-0.66122 -1.0714,-6.69272 z" },
      { m: "calves", d: "m 18.251375,70.441125 0.29058,0.91486 0.6224,3.8681 0.0829,5.15733 -0.87136,5.03304 0.0412,-6.44714 -0.91242,-2.57848 -0.12561,-2.82837 z m 1.9915,2.32915 -0.20753,7.73637 -1.65949,6.23904 1.80478,-0.853 3.00816,-10.83583 -1.03727,-6.82095 z" },
      { m: "quads", d: "m 8.2694651,50.399125 0.15504,4.75053 2.4026299,6.60968 -0.73638,1.90021 -2.3640099,-8.34435 z m 0.58117,-11.60768 0.15503,4.00684 -1.31754,7.93154 -0.61978,-6.40308 z m 0.38769,5.1223 2.7515099,6.07239 0.61997,4.87425 -1.16232,6.85771 -2.5190499,-6.98163 -0.15504,-7.18801 z" },
      { m: "adductors", d: "m 9.6258251,39.369415 v 4.21363 l 2.9451699,5.8253 1.86028,5.78349 -0.19366,-4.0072 z m 3.2488699,13.42559 0.0647,0.15485 1.21294,2.90207 -0.78307,7.18803 -1.23618,-0.66102 1.0714,-6.69273 z" },
      { m: "calves", d: "m 13.437675,70.440945 -0.29058,0.91486 -0.62241,3.86828 -0.0829,5.15733 0.87174,5.03304 -0.0418,-6.44714 0.91298,-2.57848 0.1243,-2.82837 z m -1.99151,2.32914 0.20735,7.73637 1.65968,6.23904 -1.80497,-0.85299 -3.0079799,-10.83584 1.03728,-6.82095 z" }
      ],
    },
    back: {
      viewBox: "37 0 35 93",
      body: [
      "m 48.157455,6.3585449 0.44208,-0.14964 0.16111,0.16427 1.48163,4.0475101 2.32401,1.45118 2.39971,-1.52387 0.97577,-3.6896901 0.52752,-0.55908 0.23367,0.0981 0.24198,-3.34467 -2.03129,-2.31103004 -2.84509,-0.51629 -2.20422,0.52915 -1.93631,2.63077004 z",
      "m 52.369695,12.105075 -2.35767,-1.55045 -1.47119,-3.9514301 -0.60741,0.0403 0.27409,1.82447 0.97635,0.33932 0.7613,2.2157201 0.33017,1.06849 0.0895,2.14894 1.16448,0.008 0.10563,-0.70833 0.54716,-0.0606 z m 1.01793,1.47595 0.23768,0.64982 1.38107,-0.004 0.01,-2.38784 0.25971,-0.79061 0.57215,-2.1698001 0.76359,-0.41018 0.25158,-1.78416 -0.62859,0.0193 -1.08488,3.8998101 -2.39725,1.46684 0.2768,1.48507 z",
      "M 40.716955,42.424835 l -1.5182,0.0863 -0.78184,-0.65295 -1.16168,2.1855 -0.78414,3.34805 0.49892,0.20949 0.54632,-2.2158 0.50597,0.24175 -0.29779,2.5019 0.62936,0.22875 0.35546,-2.50096 0.56242,0.16536 -0.16126,2.77057 0.77674,0.30455 0.19056,-2.87291 0.45724,-0.0289 0.22827,2.64778 0.66597,0.24774 -0.0359,-4.56685 0.33693,-0.20224 1.39227,1.65147 0.32017,-0.35115 -0.77444,-2.03749 z",
      "M 64.301385,42.592325 l 1.51839,0.0828 0.78033,-0.65476 1.16673,2.18281 0.79187,3.34623 -0.49843,0.21064 -0.55144,-2.21453 -0.50541,0.24292 0.30356,2.5012 -0.62882,0.23021 -0.36124,-2.50014 -0.56203,0.16666 0.16765,2.77019 -0.77603,0.30634 -0.19719,-2.87245 -0.45732,-0.0278 -0.22215,2.64829 -0.66539,0.24928 0.0254,-4.56692 -0.3374,-0.20146 -1.38845,1.65469 -0.32098,-0.35041 0.76973,-2.03928 z",
      "m 51.733705,14.788555 0.53876,25.33066 0.48967,-0.0297 0.65658,-25.3387 -0.28147,-0.84188 -1.25059,-4.9e-4 z",
      "m 51.176145,64.073985 -1.20605,3.01461 0.70738,0.26558 0.89754,3.51771 -0.55801,-4.01191 z m -5.08496,-3.15003 0.63355,1.8609 0.16813,2.03261 0.61314,1.93117 -0.90585,-0.0851 -0.28534,2.15982 z",
      "m 54.019305,64.073985 1.20605,3.01461 -0.70737,0.26558 -0.89755,3.51771 0.55802,-4.01191 z m 5.08496,-3.15003 -0.63355,1.8609 -0.16813,2.03261 -0.61313,1.93117 0.90584,-0.0851 0.28534,2.15982 z",
      "M 50.933115,88.340995 l 0.85194,1.3581 0.37189,0.79238 -0.15588,1.21774 -0.76984,0.74446 -1.51185,0.12543 -1.1299,-0.29192 -0.24225,-0.95894 0.80765,-1.30405 -0.22562,-0.85987 0.29679,-0.84153 -0.0194,-1.81524 1.53568,-0.54817 z m -1.19598,0.4675 0.15943,1.25776 -0.6023,0.97431 m -0.54436,0.29544 1.06474,0.40084 1.55326,-0.65137 z",
      "M 54.262335,88.340995 l -0.85194,1.3581 -0.37189,0.79238 0.15589,1.21774 0.76983,0.74446 1.51186,0.12543 1.12989,-0.29192 0.24225,-0.95894 -0.80765,-1.30405 0.22563,-0.85987 -0.29679,-0.84153 0.0194,-1.81524 -1.53568,-0.54817 z m 1.19598,0.4675 -0.15943,1.25776 0.6023,0.97431 m 0.54436,0.29544 -1.06474,0.40084 -1.55326,-0.65137 z"
      ],
      zones: [
      { m: "traps", d: "M 49.625,14.629 L 49.688,12.005 L 48.974,13.157 L 44.594,14.654 L 45.945,16.925 L 51.222,16.925 L 51.183,14.550 Z" },
      { m: "rhomboids", d: "M 46.034,17.075 L 48.920,21.925 L 51.303,21.925 L 51.224,17.075 Z" },
      { m: "rhomboids", d: "M 49.009,22.075 L 49.572,23.022 L 51.403,28.104 L 51.305,22.075 Z" },
      { m: "traps", d: "M 55.439,14.729 L 55.376,12.104 L 56.090,13.256 L 60.470,14.754 L 59.179,16.925 L 53.844,16.925 L 53.881,14.649 Z" },
      { m: "rhomboids", d: "M 59.089,17.075 L 56.204,21.925 L 53.763,21.925 L 53.842,17.075 Z" },
      { m: "rhomboids", d: "M 56.114,22.075 L 55.492,23.121 L 53.661,28.203 L 53.761,22.075 Z" },
      { m: "lats", d: "M 44.144,15.285 L 39.888,20.286 L 39.426,22.749 L 41.263,21.510 L 44.025,20.355 L 45.663,23.400 L 49.103,23.400 Z" },
      { m: "delts-rear", d: "M 42.201,16.586 L 40.626,18.152 L 39.736,20.156 L 43.992,15.155 Z" },
      { m: "lats", d: "M 45.771,23.600 L 45.872,23.789 L 47.009,29.286 L 47.023,30.400 L 51.080,30.400 L 51.053,28.314 L 49.185,23.600 Z" },
      { m: "lats", d: "M 47.026,30.600 L 47.086,35.145 L 51.156,36.255 L 51.082,30.600 Z" },
      { m: "delts-rear", d: "M 62.863,16.686 L 64.438,18.251 L 65.328,20.255 L 61.073,15.254 Z" },
      { m: "lats", d: "M 60.921,15.384 L 65.176,20.385 L 65.290,22.849 L 63.801,21.609 L 61.039,20.454 L 59.455,23.400 L 56.022,23.400 Z" },
      { m: "lats", d: "M 59.347,23.600 L 59.192,23.888 L 58.055,29.385 L 58.042,30.400 L 53.986,30.400 L 54.012,28.413 L 55.918,23.600 Z" },
      { m: "lats", d: "M 58.039,30.600 L 57.979,35.245 L 53.908,36.354 L 53.983,30.600 Z" },
      { m: "triceps", d: "M 43.593,21.039 L 44.920,23.967 L 43.615,25.653 L 43.186,27.069 L 39.209,29.802 Z" },
      { m: "triceps", d: "M 43.459,20.972 L 39.075,29.735 L 38.871,25.461 L 39.407,23.674 L 41.242,21.927 Z" },
      { m: "forearms", d: "M 40.775,29.006 L 42.870,27.644 L 42.187,29.635 L 42.603,34.383 L 40.799,42.081 L 39.814,42.253 Z" },
      { m: "forearms", d: "M 39.665,42.242 L 38.305,41.501 L 37.998,34.491 L 38.635,31.429 L 39.245,30.209 L 40.625,28.994 Z" },
      { m: "triceps", d: "M 61.376,21.213 L 60.056,24.145 L 61.330,26.199 L 61.657,27.251 L 65.780,29.966 Z" },
      { m: "triceps", d: "M 61.510,21.146 L 65.914,29.899 L 66.108,25.624 L 65.568,23.839 L 63.729,22.096 Z" },
      { m: "forearms", d: "M 65.204,42.420 L 63.925,29.007 L 61.764,27.798 L 62.786,29.733 L 62.397,34.555 L 64.219,42.248 Z" },
      { m: "forearms", d: "M 64.075,28.993 L 65.353,42.405 L 66.712,41.663 L 67.002,34.653 L 66.358,31.591 L 65.745,30.373 Z" },
      { m: "lowerback", d: "M 52.100,37.310 L 49.537,36.465 L 50.244,40.788 L 52.200,42.030 L 52.200,40.270 L 52.150,40.280 Z" },
      { m: "lowerback", d: "M 49.389,36.490 L 46.240,35.460 L 44.720,39.420 L 50.096,40.812 Z" },
      { m: "lowerback", d: "M 52.800,42.030 L 52.800,40.270 L 52.850,40.260 L 52.900,37.290 L 55.289,36.625 L 54.805,40.801 Z" },
      { m: "lowerback", d: "M 55.439,36.643 L 55.980,36.470 L 58.320,35.720 L 59.660,39.450 L 54.955,40.819 Z" },
      { m: "abductors", d: "M 50.191,41.481 L 44.740,39.690 L 43.830,41.580 L 43.431,44.301 Z" },
      { m: "glutes", d: "M 50.249,41.619 L 43.489,44.439 L 44.410,50.520 L 47.180,51.030 L 51.620,49.090 L 52.200,49.480 L 52.200,42.880 Z" },
      { m: "abductors", d: "M 55.274,41.079 L 61.354,45.519 L 60.640,42.150 L 59.740,39.860 Z" },
      { m: "glutes", d: "M 55.186,41.201 L 52.800,42.880 L 52.800,49.480 L 53.570,49.090 L 57.680,50.760 L 60.500,50.600 L 61.266,45.641 Z" },
      { m: "calves", d: "M 50.568,67.512 L 51.669,72.509 L 51.379,75.532 L 51.292,76.825 L 48.983,76.825 Z" },
      { m: "calves", d: "M 50.218,67.512 L 48.633,76.825 L 46.283,76.825 L 45.533,74.263 L 46.783,67.088 Z" },
      { m: "calves", d: "M 46.386,77.175 L 51.269,77.175 L 50.701,85.598 L 49.037,86.233 Z" },
      { m: "calves", d: "M 54.628,67.512 L 53.526,72.509 L 53.816,75.532 L 53.903,76.825 L 56.213,76.825 Z" },
      { m: "calves", d: "M 54.978,67.512 L 56.563,76.825 L 58.912,76.825 L 59.662,74.263 L 58.412,67.088 Z" },
      { m: "calves", d: "M 53.927,77.175 L 58.810,77.175 L 56.158,86.233 L 54.495,85.598 Z" },
      { m: "hamstrings", d: "M 49.550,50.504 L 51.751,49.461 L 52.389,49.692 L 52.424,51.499 L 52.499,56.145 L 50.521,62.188 L 50.997,63.602 L 49.569,66.897 L 48.755,66.754 Z" },
      { m: "hamstrings", d: "M 49.400,50.496 L 48.605,66.746 L 47.803,66.596 L 47.302,64.480 L 47.133,62.723 L 44.712,54.565 L 44.369,50.918 L 47.200,51.500 Z" },
      { m: "hamstrings", d: "M 57.425,51.196 L 56.565,66.806 L 55.759,66.965 L 54.331,63.670 L 54.807,62.256 L 52.829,56.213 L 52.904,51.567 L 52.956,49.769 L 53.520,49.498 Z" },
      { m: "hamstrings", d: "M 57.575,51.204 L 60.625,50.950 L 60.616,54.633 L 58.195,62.791 L 58.026,64.547 L 57.525,66.663 L 56.715,66.814 Z" }
      ],
    },
  };
  function anatomyFigureSvg(view) {
    const F = ANATOMY_FIG[view];
    const body = F.body.map((d) => `<path class="a-body" d="${d}"/>`).join("");
    const zones = F.zones.map((z) => `<path class="a-zone" data-muscle="${z.m}" d="${z.d}"/>`).join("");
    return `<svg class="a-svg${view === "front" ? "" : " hidden"}" data-fig="${view}" viewBox="${F.viewBox}" `
      + `role="img" aria-label="${view} muscle map" preserveAspectRatio="xMidYMid meet">`
      + `<g class="a-backdrop">${body}</g>`
      + `<g class="a-zones">${zones}</g></svg>`;
  }

  function anatomyDetailHtml(g) {
    const li = (t) => `<li>${escapeHtml(t)}</li>`;
    const chip = (n, anchor) => `<span class="a-ex-chip${anchor ? " anchor" : ""}">${escapeHtml(n)}</span>`;
    const fact = (label, val) => val ? `<div class="a-fact"><span class="a-fact-label">${label}</span><span class="a-fact-val">${escapeHtml(val)}</span></div>` : "";
    return `<div class="a-card">
      <div class="a-card-head">
        <h3>${escapeHtml(g.name)}</h3>
        <span class="a-pattern" data-pattern="${g.pattern.toLowerCase()}">${escapeHtml(g.pattern)}</span>
      </div>
      <p class="a-sub">${escapeHtml(g.sub)}</p>
      <p class="a-does">${escapeHtml(g.does)}</p>
      ${g.why ? `<p class="a-why">${escapeHtml(g.why)}</p>` : ""}
      ${(ANATOMY_MUSCLES[g.id] && ANATOMY_MUSCLES[g.id].length) ? `<div class="a-muscles">
        <h4>Muscles in this group</h4>
        <ul class="a-muscle-list">${ANATOMY_MUSCLES[g.id].map((m) => `<li>${escapeHtml(m)}</li>`).join("")}</ul>
      </div>` : ""}
      <div class="a-cols">
        <div class="a-col a-cues"><h4>Coaching cues</h4><ul>${g.cues.map(li).join("")}</ul></div>
        <div class="a-col a-miss"><h4>Common mistakes</h4><ul>${g.mistakes.map(li).join("")}</ul></div>
      </div>
      ${(g.stretches || g.injuries) ? `<div class="a-cols">
        ${g.stretches ? `<div class="a-col a-stretch"><h4>Stretches</h4><ul>${g.stretches.map(li).join("")}</ul></div>` : ""}
        ${g.injuries ? `<div class="a-col a-injury"><h4>Common injuries</h4><ul>${g.injuries.map(li).join("")}</ul></div>` : ""}
      </div>` : ""}
      ${(g.warmup || g.pairs || g.frequency) ? `<div class="a-facts">
        ${fact("Warm-up", g.warmup)}${fact("Pairs with", g.pairs)}${fact("Frequency", g.frequency)}
      </div>` : ""}
      <div class="a-ex">
        <h4>Example exercises</h4>
        <div class="a-ex-chips">
          ${g.anchors.map((n) => chip(n, true)).join("")}
          ${g.accessories.map((n) => chip(n, false)).join("")}
        </div>
      </div>
    </div>`;
  }

  // Strength Science: plain-language explainers for the ideas behind why
  // training makes you stronger. Rendered as tap-to-open cards below the muscle
  // explorer on the Anatomy page (coach + athlete). Static reference content.
  const STRENGTH_CONCEPTS = [
    { group: "The nervous system", tag: "Neural", items: [
      { term: "Motor unit recruitment", short: "How many muscle fibers you switch on.",
        def: "A motor unit is a single nerve plus all the muscle fibers it controls. Your body switches them on smallest first, saving the big, high-force units for when they are truly needed (the size principle). Easy efforts only wake the small ones.",
        strength: "To train your strongest fibers you have to give them a reason to show up: heavy loads, or lighter loads moved with maximum intent. Cruising through easy sets leaves your biggest engines parked." },
      { term: "Rate coding", short: "How fast those fibers fire, not just how many.",
        def: "Once a motor unit is switched on, the nervous system squeezes more force out of it by firing the nerve faster, sending impulses in a quicker, tighter train. At near-maximal efforts, when there are no more units left to recruit, faster firing is your main remaining way to make more force.",
        strength: "Rate coding is a big reason you get stronger before you get bigger: the same muscle makes more force because you taught it to fire faster. Heavy lifting and pushing every rep with real speed and intent develop it, so even a grinder should try to move the bar fast." },
      { term: "Neural gains vs. growth", short: "Why early strength jumps without new muscle.",
        def: "The first several weeks of a new program deliver quick strength gains that are mostly neural: better recruitment, faster rate coding, cleaner coordination, and less protective braking. Actual new muscle takes longer to build.",
        strength: "This is beginner gains. It also explains why advanced lifters chase strength with heavy, low-rep work: near a plateau, the nervous system, not just muscle size, is where fresh strength comes from." },
      { term: "Strength is a skill", short: "Your body learns the lift, not just the muscle.",
        def: "A heavy lift is a coordinated act: the prime movers fire hard, the stabilizers time up, and the opposing muscles relax out of the way. The nervous system gets better at this pattern with practice, the way any skill improves.",
        strength: "Part of getting stronger at squat or bench is simply getting better at that exact movement. It is why practicing the main lifts beats only training around them." },
      { term: "The safety brake", short: "Autogenic inhibition, and how training eases it.",
        def: "Sensors in your tendons can dial force down to protect the joint when tension spikes, a built-in brake. Consistent heavy training raises that brake's threshold, letting you reach more of the strength you already own.",
        strength: "Some of your max strength gain is not new force at all, it is permission to use what was there. Gradual, heavy exposure is what turns the brake down safely." },
    ] },
    { group: "Muscle and growth", tag: "Muscle", items: [
      { term: "Muscle fiber types", short: "Slow-twitch endurance vs. fast-twitch force.",
        def: "Type I (slow-twitch) fibers resist fatigue and are built for endurance. Type II (fast-twitch) fibers make much more force, contract faster, and tire quickly. Most muscles are a mix, and your training biases which qualities develop.",
        strength: "Strength and power lean on fast-twitch fibers. Heavy loads and explosive efforts recruit and develop them; endless light reps mostly train endurance." },
      { term: "Mechanical tension", short: "The main signal that tells muscle to grow.",
        def: "High tension held across a muscle through a full range of motion, produced by heavy load or hard effort taken close to failure, is the primary driver of muscle growth.",
        strength: "More muscle means more contractile tissue and a higher strength ceiling. Tension is the shared currency: it drives both size and, alongside neural work, force." },
      { term: "Progressive overload", short: "Give the body a reason to keep adapting.",
        def: "Gradually increasing the demand over time, whether load, reps, sets, range, or better control, forces your body to keep adapting. Repeat the exact same workout forever and progress stalls.",
        strength: "This is the master principle under everything else. No progressive overload, no lasting strength." },
      { term: "Stretch-shortening cycle", short: "Load the spring, then fire.",
        def: "When a muscle is quickly stretched (the lowering phase) then immediately reverses into shortening (the lifting phase), it stores and releases elastic energy like a loaded spring. The dip before a jump and the bounce out of the bottom of a bench both use it.",
        strength: "It is the root of power and explosive lifts. Controlled tempo work and plyometrics such as jumps and throws sharpen it." },
    ] },
    { group: "Building muscle", tag: "Hypertrophy", items: [
      { term: "Muscle protein synthesis", short: "The repair that actually adds size.",
        def: "A hard session raises the rate at which your muscle builds new protein for roughly a day or two afterward. Growth happens when that synthesis outpaces the normal breakdown, session after session.",
        strength: "This is why food and rest between workouts matter as much as the workout. Enough protein and recovery are what let the repaired tissue accumulate into a bigger, stronger muscle." },
      { term: "Training volume", short: "Hard sets are the main dial for growth.",
        def: "The number of hard sets you give a muscle each week is the strongest lever for how much it grows. Within reason, more quality sets means more growth, up to the point where you can no longer recover from them.",
        strength: "A bigger muscle has a higher strength ceiling, so managing weekly sets, not just how heavy you go, is a big part of getting and staying strong." },
      { term: "Proximity to failure", short: "How close to your limit the set ends.",
        def: "Sets taken within a few reps of failure recruit the most fibers and drive the most growth. Stopping well short, with lots left in the tank, leaves a good chunk of the stimulus behind.",
        strength: "You do not need to grind every set to failure, but the last few tough reps before it are where most of the muscle-building signal lives. Effort is not optional." },
      { term: "Metabolic stress (the pump)", short: "The burn and swell of hard, continuous work.",
        def: "Higher-rep sets with short rest trap blood and metabolites in the muscle, the pump you feel. It is a secondary growth signal that stacks on top of heavy mechanical tension.",
        strength: "A useful tool for adding size to smaller muscles and for training around joints that do not tolerate heavy loading well." },
      { term: "Recovery and supercompensation", short: "You grow between sessions, not during them.",
        def: "Training is only the stimulus. The actual repair and growth happen while you rest, sleep, and eat. Train again before you have recovered and you dig a hole; time it right and you come back a little stronger than before.",
        strength: "Progress is training plus recovery, not training alone. Sleep and food are not extras, they are where the adaptation is built." },
    ] },
    { group: "Length and mobility", tag: "Stretching", items: [
      { term: "Flexibility vs. mobility", short: "Passive range vs. range you control.",
        def: "Flexibility is how far a joint can be moved when something else does the moving. Mobility is how much of that range you can reach and control with your own strength. For lifting, controllable mobility is the more useful quality.",
        strength: "Strong through a full range beats loose but shaky. Mobility work is what lets you own the bottom of a squat or a deep stretch instead of just falling into it." },
      { term: "Static vs. dynamic stretching", short: "Hold-and-relax vs. move-through-range.",
        def: "Static stretching holds a lengthened position for time. Dynamic stretching moves a joint through its range again and again. Dynamic drills warm tissue up for work; long static holds are better saved for after training or a separate session.",
        strength: "Dynamic movement before you lift preps the pattern. A long, hard static stretch right before a max effort can briefly dull how much force you produce, so save it for later." },
      { term: "Stretch-mediated hypertrophy", short: "Loading a muscle while it is long grows it.",
        def: "Training a muscle under load in a stretched position, through deep ranges or lengthened partials, appears to drive extra growth compared with short, easy ranges of motion.",
        strength: "Full range of motion is not only a mobility habit. The stretched portion of a lift is some of the most productive muscle-building work you can do, so do not cut your reps short." },
      { term: "Range of motion", short: "Full ROM usually beats partial.",
        def: "Taking a lift through its complete range trains the muscle at every length it works through, and generally builds more size and usable strength than short, partial reps. Targeted partials still have a place on top of that.",
        strength: "Do not trade honest range for a heavier number. Full-range strength carries over to real life and to your other lifts far better than a shortened one." },
      { term: "The stretch reflex", short: "A fast stretch fires a protective contraction.",
        def: "Stretch a muscle quickly and a built-in reflex fires it to contract, guarding it against being pulled too far, the myotatic reflex. It is why you ease into a stretch rather than bounce into it.",
        strength: "That same reflex feeds the spring in explosive lifts. For flexibility, slow and relaxed stretching lets the reflex settle so your range can genuinely improve." },
    ] },
    { group: "Training language", tag: "Programming", items: [
      { term: "1RM and rep maxes", short: "The vocabulary of intensity.",
        def: "Your 1RM is the most you can lift once. A rep max (RM) is the most reps you can do at a given weight: a 5RM is a weight you can lift five times and no more. Programs often set loads as a percentage of your 1RM.",
        strength: "Knowing your maxes lets a program target the right intensity for the goal: heavy and low-rep for strength, moderate for size." },
      { term: "RPE and RIR", short: "Auto-adjusting effort to the day.",
        def: "RPE (rate of perceived exertion) rates how hard a set felt, usually on a 1 to 10 scale. RIR (reps in reserve) is the flip side: how many good reps you had left. An RPE 8 or 2 RIR set means you stopped about two reps shy of failure.",
        strength: "These let you hit the right effort on a good or bad day instead of blindly chasing a number, so you manage fatigue while still pushing." },
      { term: "Specificity (SAID)", short: "You get good at exactly what you do.",
        def: "SAID stands for Specific Adaptations to Imposed Demands: your body adapts to the precise demand you place on it, meaning the movement, speed, range, and load.",
        strength: "To get strong at a lift, train that lift and that quality. Carryover from other exercises helps, but nothing replaces practicing the thing itself." },
    ] },
  ];

  function strengthConceptsHtml() {
    return `<section class="a-concepts">
      <div class="a-concepts-head">
        <h3>Strength Science</h3>
        <p>Plain-language explainers for the ideas behind how training makes you stronger. Tap any card to open it.</p>
      </div>
      ${STRENGTH_CONCEPTS.map((grp) => `<div class="a-cgroup">
        <h4 class="a-cgroup-title">${escapeHtml(grp.group)}<span class="a-cgroup-tag">${escapeHtml(grp.tag)}</span></h4>
        <div class="a-cgrid">
          ${grp.items.map((c) => `<details class="a-concept">
            <summary class="a-concept-sum">
              <span class="a-concept-text"><span class="a-concept-term">${escapeHtml(c.term)}</span><span class="a-concept-short">${escapeHtml(c.short)}</span></span>
              <span class="a-concept-chev" aria-hidden="true"></span>
            </summary>
            <div class="a-concept-body">
              <p class="a-concept-def">${escapeHtml(c.def)}</p>
              <p class="a-concept-str"><span class="a-concept-str-label">Why it helps strength</span>${escapeHtml(c.strength)}</p>
            </div>
          </details>`).join("")}
        </div>
      </div>`).join("")}
    </section>`;
  }

  // Build the anatomy UI into one container. Static, built once per node.
  function buildAnatomy(root) {
    if (root.dataset.anatomyBuilt) return;
    root.dataset.anatomyBuilt = "1";
    root.classList.add("anatomy"); // enables the column layout + section spacing
    root.innerHTML = `
      <p class="anatomy-intro">Tap a muscle on the body or in the list to see what it does, how to train it, and example lifts.</p>
      <div class="anatomy-toggle" role="tablist">
        <button type="button" class="a-view-btn active" data-view="front">Front</button>
        <button type="button" class="a-view-btn" data-view="back">Back</button>
      </div>
      <div class="anatomy-layout">
        <div class="anatomy-figure">${anatomyFigureSvg("front")}${anatomyFigureSvg("back")}</div>
        <div class="anatomy-side">
          <div class="anatomy-list" data-anatomy-list></div>
          <div class="anatomy-detail" data-anatomy-detail>
            <div class="anatomy-detail-empty">Select a muscle group to see the details.</div>
          </div>
        </div>
      </div>
      ${strengthConceptsHtml()}`;

    const listEl = root.querySelector("[data-anatomy-list]");
    const detailEl = root.querySelector("[data-anatomy-detail]");
    let view = "front";
    let selected = null;

    function renderList() {
      listEl.innerHTML = ANATOMY_VIEW_GROUPS[view].map((id) => {
        const g = ANATOMY_BY_ID[id];
        return `<button type="button" class="a-chip${id === selected ? " selected" : ""}" data-muscle="${id}">${escapeHtml(g.name)}</button>`;
      }).join("");
    }
    function highlight() {
      root.querySelectorAll(".a-zone.selected, .a-chip.selected").forEach((el) => el.classList.remove("selected"));
      if (!selected) return;
      root.querySelectorAll(`.a-svg[data-fig="${view}"] .a-zone[data-muscle="${selected}"], .a-chip[data-muscle="${selected}"]`)
        .forEach((el) => el.classList.add("selected"));
    }
    function select(id) {
      const g = ANATOMY_BY_ID[id];
      if (!g) return;
      selected = id;
      detailEl.innerHTML = anatomyDetailHtml(g);
      highlight();
    }
    function setView(next) {
      if (next === view) return;
      view = next;
      root.querySelectorAll(".a-view-btn").forEach((b) => b.classList.toggle("active", b.dataset.view === view));
      root.querySelectorAll(".a-svg").forEach((s) => s.classList.toggle("hidden", s.dataset.fig !== view));
      // Keep the selection if the group also lives in the new view, else clear.
      if (selected && !ANATOMY_VIEW_GROUPS[view].includes(selected)) {
        selected = null;
        detailEl.innerHTML = '<div class="anatomy-detail-empty">Select a muscle group to see the details.</div>';
      }
      renderList();
      highlight();
    }

    root.querySelectorAll(".a-view-btn").forEach((b) =>
      b.addEventListener("click", () => setView(b.dataset.view)));
    root.addEventListener("click", (e) => {
      const zone = e.target.closest(".a-zone, .a-chip");
      if (zone && root.contains(zone)) select(zone.dataset.muscle);
    });
    renderList();
  }
  // Build every anatomy mount point once at boot (coach view + athlete tab).
  function initAnatomyLibrary() {
    document.querySelectorAll("[data-anatomy-root]").forEach(buildAnatomy);
  }

  // Rebuild a single shared <datalist> (respecting the coach's hidden list) and
  // return its id so type-to-add inputs can point at it via `list=`.
  function ensureExerciseDatalist() {
    const hidden = state.trainerData.hiddenExercises || [];
    let dl = document.getElementById("ex-name-datalist");
    if (!dl) {
      dl = document.createElement("datalist");
      dl.id = "ex-name-datalist";
      document.body.appendChild(dl);
    }
    const names = [...new Set([...ALL_EXERCISE_NAMES, ...customExerciseList().map((c) => c.name)])]
      .sort((a, b) => a.localeCompare(b));
    dl.innerHTML = names
      .filter((n) => !hidden.includes(n))
      .map((n) => `<option value="${escapeHtml(n)}"></option>`)
      .join("");
    return "ex-name-datalist";
  }

  // Coach-added custom exercises. Guarded for the athlete side, where
  // trainerData may not exist.
  function customExerciseList() {
    return state.trainerData?.customExercises || [];
  }
  function isCustomExercise(name) {
    return customExerciseList().some((c) => c.name === name);
  }

  // Built-in library merged with the coach's custom exercises. Customs filed
  // under a built-in category append to it; unknown categories become new ones.
  function fullExerciseLibrary() {
    const cats = EXERCISE_LIBRARY.map((c) => ({ cat: c.cat, ex: [...c.ex] }));
    for (const ce of customExerciseList()) {
      if (!ce?.name) continue;
      const cat = ce.cat || "My Exercises";
      let entry = cats.find((c) => c.cat === cat);
      if (!entry) { entry = { cat, ex: [] }; cats.push(entry); }
      if (!entry.ex.includes(ce.name)) entry.ex.push(ce.name);
    }
    return cats;
  }

  // Coach's custom category order (array of cat names, persisted in trainerData).
  // Categories not in the saved order (e.g. added in an app update) keep their
  // built-in position at the end.
  function orderedExerciseLibrary() {
    const lib = fullExerciseLibrary();
    const saved = Array.isArray(state.trainerData.exCatOrder) ? state.trainerData.exCatOrder : [];
    const byCat = new Map(lib.map((c) => [c.cat, c]));
    const out = [];
    const seen = new Set();
    for (const cat of saved) {
      const entry = byCat.get(cat);
      if (entry && !seen.has(cat)) { out.push(entry); seen.add(cat); }
    }
    for (const entry of lib) if (!seen.has(entry.cat)) out.push(entry);
    return out;
  }

  function addCustomExercise(rawName, rawCat) {
    const name = (rawName || "").trim();
    const cat = (rawCat || "").trim() || "My Exercises";
    if (!name) { toast("Enter an exercise name"); return false; }
    const clash = fullExerciseLibrary().some((c) => c.ex.some((e) => e.toLowerCase() === name.toLowerCase()));
    if (clash) {
      const hidden = state.trainerData.hiddenExercises || [];
      toast(hidden.some((h) => h.toLowerCase() === name.toLowerCase())
        ? "Already in the library. Check the Hidden tab"
        : "That exercise is already in the library");
      return false;
    }
    if (!Array.isArray(state.trainerData.customExercises)) state.trainerData.customExercises = [];
    state.trainerData.customExercises.push({ name, cat });
    _expandedExCats.add(cat); // show the new exercise right away
    saveTrainer();
    ensureExerciseDatalist();
    renderExLibrary($("#ex-library-search")?.value || "");
    renderSidebarLibrary($("#ex-lib-sb-search")?.value || "");
    toast(`Added ${name} to the library 💪`);
    return true;
  }

  function deleteCustomExercise(name) {
    if (!window.confirm(`Remove "${name}" from your library? Days already using it keep it.`)) return;
    state.trainerData.customExercises = customExerciseList().filter((c) => c.name !== name);
    saveTrainer();
    ensureExerciseDatalist();
    renderExLibrary($("#ex-library-search")?.value || "");
    renderSidebarLibrary($("#ex-lib-sb-search")?.value || "");
    toast("Custom exercise removed");
  }

  // Wire one "+ Custom exercise" button/form pair (sidebar and modal each have
  // one; ids share a prefix: `${prefix}-btn`, `-form`, `-name`, `-cat`,
  // `-newcat`, `-save`, `-cancel`).
  function setupExAddForm(prefix) {
    const btn = $(`#${prefix}-btn`), form = $(`#${prefix}-form`),
          nameEl = $(`#${prefix}-name`), catEl = $(`#${prefix}-cat`),
          newCatEl = $(`#${prefix}-newcat`), saveEl = $(`#${prefix}-save`),
          cancelEl = $(`#${prefix}-cancel`);
    if (!btn || !form) return;
    const close = () => { hide(form); show(btn); };
    btn.addEventListener("click", () => {
      catEl.innerHTML = orderedExerciseLibrary()
        .map(({ cat }) => `<option value="${escapeHtml(cat)}">${escapeHtml(cat)}</option>`)
        .join("") + `<option value="__new__">➕ New category…</option>`;
      nameEl.value = "";
      newCatEl.value = "";
      hide(newCatEl);
      show(form); hide(btn);
      nameEl.focus();
    });
    catEl.addEventListener("change", () => {
      if (catEl.value === "__new__") { show(newCatEl); newCatEl.focus(); }
      else hide(newCatEl);
    });
    const submit = () => {
      const cat = catEl.value === "__new__" ? newCatEl.value.trim() : catEl.value;
      if (catEl.value === "__new__" && !cat) { toast("Enter a category name"); newCatEl.focus(); return; }
      if (addCustomExercise(nameEl.value, cat)) close();
    };
    saveEl.addEventListener("click", submit);
    cancelEl.addEventListener("click", close);
    [nameEl, newCatEl].forEach((el) => el.addEventListener("keydown", (e) => {
      if (e.key === "Enter") { e.preventDefault(); submit(); }
      if (e.key === "Escape") close();
    }));
  }
  function moveExCategory(cat, dir) {
    const order = orderedExerciseLibrary().map((c) => c.cat);
    const i = order.indexOf(cat);
    const j = i + dir;
    if (i === -1 || j < 0 || j >= order.length) return;
    [order[i], order[j]] = [order[j], order[i]];
    state.trainerData.exCatOrder = order;
    saveTrainer();
    renderExLibrary($("#ex-library-search")?.value || "");
    renderSidebarLibrary($("#ex-lib-sb-search")?.value || "");
  }

  // Which categories are expanded (session-only — everything starts collapsed).
  // Shared by the modal library and the sidebar library.
  const _expandedExCats = new Set();
  function toggleExCategory(cat) {
    if (_expandedExCats.has(cat)) _expandedExCats.delete(cat);
    else _expandedExCats.add(cat);
    renderExLibrary($("#ex-library-search")?.value || "");
    renderSidebarLibrary($("#ex-lib-sb-search")?.value || "");
  }

  function openExLibrary(day, rerenderFn) {
    _exLibraryTarget = day ? { day, rerenderFn } : null;
    $("#ex-library-overlay").classList.remove("athlete-mode");
    show($("#ex-library-overlay"));
    renderExLibrary($("#ex-library-search").value || "");
    setTimeout(() => $("#ex-library-search").focus(), 100);
  }
  function closeExLibrary() { hide($("#ex-library-overlay")); _exLibraryTarget = null; }

  // Athlete "add an exercise on the fly" — same library drawer, but picks land
  // in the athlete's progress (addedExercises) instead of the coach's program.
  function openAthleteExLibrary(day) {
    _exLibraryTarget = { onAdd: (name) => addAthleteExercise(day, name) };
    $("#ex-library-overlay").classList.add("athlete-mode"); // hides coach-only "custom exercise"
    show($("#ex-library-overlay"));
    renderExLibrary($("#ex-library-search").value || "");
    setTimeout(() => $("#ex-library-search").focus(), 100);
  }
  function addAthleteExercise(day, name) {
    const p = state.clientData.progress;
    if (!p.addedExercises) p.addedExercises = {};
    const list = p.addedExercises[day.id] || (p.addedExercises[day.id] = []);
    if (list.length >= MAX_ADDED_PER_DAY) {
      toast(`You can add up to ${MAX_ADDED_PER_DAY} extra exercises per day.`);
      return;
    }
    const ex = makeExercise({ name });
    ex.addedByAthlete = true;
    ex.addedAt = Date.now();
    list.push(ex);
    saveClient();
    toast(`Added ${name}`);
    if (list.length >= MAX_ADDED_PER_DAY) closeExLibrary();
    renderWorkoutDetailUI();
  }
  function removeAthleteExercise(day, ex) {
    const p = state.clientData.progress;
    const list = p.addedExercises?.[day.id];
    if (!list) return;
    const hasLog = p.exerciseLogs?.[ex.id]?.length;
    if (hasLog && !window.confirm(`Remove "${ex.name}" and the sets you logged for it?`)) return;
    p.addedExercises[day.id] = list.filter((e) => e.id !== ex.id);
    if (!p.addedExercises[day.id].length) delete p.addedExercises[day.id];
    if (p.exerciseLogs?.[ex.id]) delete p.exerciseLogs[ex.id]; // drop its orphaned log
    saveClient();
    renderWorkoutDetailUI();
  }
  function renderExLibrary(filter) {
    const q = filter.toLowerCase().trim();
    const body = $("#ex-library-body");
    const hidden = state.trainerData.hiddenExercises || [];
    const cats = orderedExerciseLibrary();
    let html = "";
    cats.forEach(({ cat, ex }, idx) => {
      let items = ex.filter((e) => !hidden.includes(e));
      if (q) items = items.filter((e) => e.toLowerCase().includes(q));
      if (!items.length) return;
      // Searching force-expands every matching category so results stay visible.
      const open = !!q || _expandedExCats.has(cat);
      html += `<div class="ex-cat-header${open ? " open" : ""}" data-cat="${escapeHtml(cat)}">
        <span class="ex-cat-caret">${open ? "▾" : "▸"}</span>
        <span class="ex-cat-title">${escapeHtml(cat)}</span>
        <span class="ex-cat-count">${items.length}</span>
        ${q ? "" : `<span class="ex-cat-move">
          <button type="button" class="ex-cat-move-btn" data-move="-1" data-cat="${escapeHtml(cat)}" title="Move category up"${idx === 0 ? " disabled" : ""}>↑</button>
          <button type="button" class="ex-cat-move-btn" data-move="1" data-cat="${escapeHtml(cat)}" title="Move category down"${idx === cats.length - 1 ? " disabled" : ""}>↓</button>
        </span>`}
      </div>`;
      if (open) html += items.map((name) =>
        `<div class="ex-lib-item" draggable="true" data-exname="${escapeHtml(name)}">${escapeHtml(name)}</div>`
      ).join("");
    });
    body.innerHTML = html || '<div class="ex-lib-empty">No exercises found.</div>';
    body.querySelectorAll(".ex-cat-header").forEach((h) => {
      h.addEventListener("click", () => { if (!q) toggleExCategory(h.dataset.cat); });
    });
    body.querySelectorAll(".ex-cat-move-btn").forEach((btn) => {
      btn.addEventListener("click", (e) => {
        e.stopPropagation();
        moveExCategory(btn.dataset.cat, Number(btn.dataset.move));
      });
    });
    body.querySelectorAll(".ex-lib-item").forEach((item) => {
      item.addEventListener("dragstart", (e) => {
        e.dataTransfer.setData("text/ex-name", item.dataset.exname);
        e.dataTransfer.effectAllowed = "copy";
      });
      // Tap-to-add — drag-and-drop doesn't work on touch devices, so this is
      // the primary path on mobile (where the library opens as this modal
      // instead of the persistent sidebar).
      item.addEventListener("click", () => {
        if (!_exLibraryTarget) return;
        // Athlete flow: hand the name off to the caller (adds to their progress).
        if (_exLibraryTarget.onAdd) { _exLibraryTarget.onAdd(item.dataset.exname); return; }
        const { day, rerenderFn } = _exLibraryTarget;
        day.exercises.push(makeExercise({ name: item.dataset.exname }));
        saveTrainer();
        toast(`Added ${item.dataset.exname}`);
        rerenderFn();
      });
    });
  }

  // -------- Persistent Library Sidebar --------
  // Which tab is showing: "active" (draggable library) or "hidden" (parked exercises).
  let _libSbTab = "active";

  function hideExercise(name) {
    if (!Array.isArray(state.trainerData.hiddenExercises)) state.trainerData.hiddenExercises = [];
    if (!state.trainerData.hiddenExercises.includes(name)) {
      state.trainerData.hiddenExercises.push(name);
      saveTrainer();
    }
    renderSidebarLibrary($("#ex-lib-sb-search")?.value || "");
  }
  function unhideExercise(name) {
    state.trainerData.hiddenExercises = (state.trainerData.hiddenExercises || []).filter((n) => n !== name);
    saveTrainer();
    renderSidebarLibrary($("#ex-lib-sb-search")?.value || "");
  }

  function renderSidebarLibrary(filter) {
    const q = (filter || "").toLowerCase().trim();
    const body = $("#ex-lib-sb-body");
    if (!body) return;
    const hidden = state.trainerData.hiddenExercises || [];
    const showingHidden = _libSbTab === "hidden";

    // Keep the tab UI + hint in sync with the active tab.
    $$(".ex-lib-sb-tab").forEach((t) => t.classList.toggle("active", t.dataset.libTab === _libSbTab));
    const countEl = $("#ex-lib-hidden-count");
    if (countEl) countEl.textContent = hidden.length ? `(${hidden.length})` : "";
    const hintEl = $("#ex-lib-sb-hint");
    if (hintEl) hintEl.textContent = showingHidden ? "Tap ↩ to restore" : "Drag onto a day";

    body.innerHTML = "";
    const cats = orderedExerciseLibrary();
    cats.forEach(({ cat, ex }, idx) => {
      let items = ex.filter((e) => (showingHidden ? hidden.includes(e) : !hidden.includes(e)));
      if (q) items = items.filter((e) => e.toLowerCase().includes(q));
      if (!items.length) return;
      // Searching force-expands every matching category so results stay visible.
      const open = !!q || _expandedExCats.has(cat);
      const catEl = document.createElement("div");
      catEl.className = "ex-lib-sb-cat" + (open ? " open" : "");

      const caret = document.createElement("span");
      caret.className = "ex-cat-caret";
      caret.textContent = open ? "▾" : "▸";
      catEl.appendChild(caret);

      const title = document.createElement("span");
      title.className = "ex-cat-title";
      title.textContent = cat;
      catEl.appendChild(title);

      const count = document.createElement("span");
      count.className = "ex-cat-count";
      count.textContent = items.length;
      catEl.appendChild(count);

      // Reorder arrows: active tab only, and not while searching (the visible
      // neighbours wouldn't match the real order).
      if (!showingHidden && !q) {
        const moveWrap = document.createElement("span");
        moveWrap.className = "ex-cat-move";
        [["-1", "↑", "Move category up", idx === 0], ["1", "↓", "Move category down", idx === cats.length - 1]].forEach(([dir, sym, tip, atEdge]) => {
          const mb = document.createElement("button");
          mb.type = "button";
          mb.className = "ex-cat-move-btn";
          mb.textContent = sym;
          mb.title = tip;
          mb.disabled = atEdge;
          mb.addEventListener("click", (e) => { e.stopPropagation(); moveExCategory(cat, Number(dir)); });
          moveWrap.appendChild(mb);
        });
        catEl.appendChild(moveWrap);
      }

      catEl.addEventListener("click", () => { if (!q) toggleExCategory(cat); });
      body.appendChild(catEl);
      if (!open) return;
      items.forEach((name) => {
        const item = document.createElement("div");
        item.className = "ex-lib-sb-item" + (showingHidden ? " is-hidden-row" : "");

        const label = document.createElement("span");
        label.className = "ex-lib-sb-item-name";
        label.textContent = name;
        item.appendChild(label);

        const btn = document.createElement("button");
        btn.type = "button";
        btn.className = "ex-lib-sb-actbtn";
        if (showingHidden) {
          btn.textContent = "↩";
          btn.title = "Restore to library";
          btn.addEventListener("click", (e) => { e.stopPropagation(); unhideExercise(name); });
        } else if (isCustomExercise(name)) {
          btn.textContent = "🗑";
          btn.title = "Delete custom exercise";
          btn.addEventListener("click", (e) => { e.stopPropagation(); deleteCustomExercise(name); });
        } else {
          btn.textContent = "✕";
          btn.title = "Hide from library";
          btn.addEventListener("click", (e) => { e.stopPropagation(); hideExercise(name); });
        }
        item.appendChild(btn);

        // Only active-library rows are drag sources.
        if (!showingHidden) {
          item.draggable = true;
          item.dataset.exname = name;
          item.addEventListener("dragstart", (e) => {
            item.classList.add("dragging-active");
            e.dataTransfer.setData("text/ex-name", name);
            e.dataTransfer.effectAllowed = "copy";
          });
          item.addEventListener("dragend", () => item.classList.remove("dragging-active"));
        }
        body.appendChild(item);
      });
    });
    if (!body.children.length) {
      const msg = showingHidden
        ? (hidden.length ? "No hidden exercises match your search." : "No hidden exercises. Tap ✕ on a library exercise to park it here.")
        : "No exercises found.";
      body.innerHTML = `<div style="padding:1rem;color:var(--muted);font-size:0.82rem">${msg}</div>`;
    }
  }

  function setLibSbTab(tab) {
    _libSbTab = tab === "hidden" ? "hidden" : "active";
    renderSidebarLibrary($("#ex-lib-sb-search")?.value || "");
  }

  function showLibSidebar() {
    const layout = document.querySelector(".coach-layout");
    if (layout) layout.classList.add("show-lib-sidebar");
    renderSidebarLibrary($("#ex-lib-sb-search")?.value || "");
  }
  function hideLibSidebar() {
    const layout = document.querySelector(".coach-layout");
    if (layout) layout.classList.remove("show-lib-sidebar");
  }

  // -------- Picker value tables --------
  const REPS_VALUES   = [...Array.from({ length: 30 }, (_, i) => String(i + 1)), "AMAP"];
  const SETS_VALUES   = ["1","2","3","4","5","6"];
  const WEIGHT_RANGES = [
    { label: "BW · Bar", values: ["BW", "BAR"] },
    { label: "5–100",   values: Array.from({length:20}, (_,i) => String((i+1)*5)) },
    { label: "105–200", values: Array.from({length:20}, (_,i) => String(105+i*5)) },
    { label: "205–300", values: Array.from({length:20}, (_,i) => String(205+i*5)) },
    { label: "305–400", values: Array.from({length:20}, (_,i) => String(305+i*5)) },
    { label: "405+",    values: Array.from({length:80}, (_,i) => String(405+i*5)) },
  ];

  function _positionPop(pop, anchor) {
    const r = anchor.getBoundingClientRect();
    const pr = pop.getBoundingClientRect();
    let left = r.left;
    left = Math.max(8, Math.min(left, window.innerWidth - pr.width - 8));
    let top = r.bottom + 6;
    if (top + pr.height > window.innerHeight - 8) top = r.top - pr.height - 6;
    if (top < 8) top = 8;
    pop.style.left = left + "px";
    pop.style.top  = top  + "px";
    pop.style.visibility = "visible";
  }

  function _attachOutsideClose(pop, anchorEl) {
    const handler = (e) => {
      if (!pop.contains(e.target) && e.target !== anchorEl) {
        pop.remove();
        document.removeEventListener("mousedown", handler, true);
      }
    };
    document.addEventListener("mousedown", handler, true);
  }

  function openGridPicker(label, values, currentVal, cb, anchorEl, cols) {
    document.querySelector(".grid-picker-pop")?.remove();
    const pop = document.createElement("div");
    pop.className = "grid-picker-pop";
    pop.style.cssText = "position:fixed;z-index:9999;visibility:hidden";

    if (label) {
      const head = document.createElement("div");
      head.className = "grid-picker-head";
      head.textContent = label;
      pop.appendChild(head);
    }

    const numCols = cols || values.length; // for small sets: all in one row
    const grid = document.createElement("div");
    grid.className = "grid-picker-grid";
    grid.style.gridTemplateColumns = `repeat(${numCols}, 1fr)`;

    values.forEach(v => {
      const btn = document.createElement("button");
      btn.className = "grid-picker-cell" + (String(v) === String(currentVal) ? " active" : "");
      btn.textContent = String(v);
      btn.type = "button";
      btn.addEventListener("click", () => { pop.remove(); cb(String(v)); });
      grid.appendChild(btn);
    });
    pop.appendChild(grid);

    document.body.appendChild(pop);
    requestAnimationFrame(() => _positionPop(pop, anchorEl));
    _attachOutsideClose(pop, anchorEl);
  }

  // Custom gym-equipment icons (monochrome SVG, inherit text color via
  // currentColor). Stored in day.icon as "eq:<name>" tokens; rendered through
  // dayIconHtml()/setDayIcon() so every icon slot handles them alongside emoji.
  const DAY_ICON_SVGS = {
    "eq:dumbbell": '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="1.8" y="8" width="2.3" height="8" rx="1"/><rect x="4.6" y="6.5" width="2.5" height="11" rx="1"/><rect x="16.9" y="6.5" width="2.5" height="11" rx="1"/><rect x="19.9" y="8" width="2.3" height="8" rx="1"/><rect x="7" y="10.8" width="10" height="2.4" rx="1.1"/></svg>',
    "eq:barbell": '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="1.3" y="9.5" width="1.8" height="5" rx=".8"/><rect x="3.6" y="6.4" width="2.5" height="11.2" rx="1"/><rect x="6.6" y="8.6" width="1.7" height="6.8" rx=".8"/><rect x="15.7" y="8.6" width="1.7" height="6.8" rx=".8"/><rect x="17.9" y="6.4" width="2.5" height="11.2" rx="1"/><rect x="20.9" y="9.5" width="1.8" height="5" rx=".8"/><rect x="8" y="10.9" width="8" height="2.2" rx="1"/></svg>',
    "eq:kettlebell": '<svg viewBox="0 0 24 24" fill="currentColor" fill-rule="evenodd" aria-hidden="true"><path d="M12 2.4c-2.3 0-4.1 1.8-4.1 4.1 0 1.2.5 2.3 1.4 3.1A6.6 6.6 0 0 0 5.3 15 6.7 6.7 0 0 0 12 21.6 6.7 6.7 0 0 0 18.7 15a6.6 6.6 0 0 0-4-5.4c.9-.8 1.4-1.9 1.4-3.1 0-2.3-1.8-4.1-4.1-4.1Zm0 2.1c1.1 0 2 .9 2 2s-.9 2-2 2-2-.9-2-2 .9-2 2-2Z"/></svg>',
    "eq:plate": '<svg viewBox="0 0 24 24" fill="currentColor" fill-rule="evenodd" aria-hidden="true"><path d="M12 2a10 10 0 1 0 0 20 10 10 0 0 0 0-20Zm0 6.4a3.6 3.6 0 1 1 0 7.2 3.6 3.6 0 0 1 0-7.2Z"/></svg>',
    "eq:bench": '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="2.6" y="8.8" width="18.8" height="3" rx="1.3"/><rect x="4.8" y="11.8" width="2.2" height="8.2" rx="1"/><rect x="17" y="11.8" width="2.2" height="8.2" rx="1"/></svg>',
    "eq:rack": '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="3.9" y="2.6" width="2.3" height="18.8" rx="1"/><rect x="17.8" y="2.6" width="2.3" height="18.8" rx="1"/><rect x="2.8" y="7.8" width="18.4" height="2.3" rx="1"/><rect x="2.2" y="6.8" width="2" height="4.2" rx=".9"/><rect x="19.8" y="6.8" width="2" height="4.2" rx=".9"/></svg>',
    "eq:pullup": '<svg viewBox="0 0 24 24" fill="currentColor" aria-hidden="true"><rect x="2.4" y="3.8" width="19.2" height="2.4" rx="1.2"/><rect x="3.8" y="2.6" width="2.1" height="4.2" rx=".9"/><rect x="18.1" y="2.6" width="2.1" height="4.2" rx=".9"/><rect x="8.1" y="6" width="1.8" height="7.2" rx=".9"/><rect x="14.1" y="6" width="1.8" height="7.2" rx=".9"/><rect x="7.4" y="12.6" width="3.2" height="1.9" rx=".9"/><rect x="13.4" y="12.6" width="3.2" height="1.9" rx=".9"/></svg>',
    "eq:medball": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 3v18M3 12h18" stroke-width="1.4"/></svg>',
    // Stone Dragon branded set — thin-line marks matching the logo's theme.
    // Auto-picked per day name by workoutIconFor(); also coach-pickable.
    "sd:claw": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" aria-hidden="true"><path d="M5.3 4.2C8 7 9.2 11.5 8.3 16.5"/><path d="M11.6 3c3 3.6 4.2 8.8 3.2 14.8"/><path d="M17.8 4.2c2.4 2.8 3.2 6.8 2.4 10.8"/></svg>',
    "sd:talon": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15.6 3.5h-4.4"/><path d="M15.6 3.5v9.4a4.6 4.6 0 0 1-9.2 0v-2.1"/><path d="M4.5 12.7l1.9-1.9 1.9 1.9"/></svg>',
    "sd:press": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4.5 20.2h15"/><path d="M12 16.2V5.2"/><path d="M7.6 9.4 12 5l4.4 4.4"/></svg>',
    "sd:mountain": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2.8 19.5 8.9 8.4l4 6.4 2.6-4.1 5.7 8.8Z"/></svg>',
    "sd:scale": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3.2c2.6 1.9 5 2.8 7.3 2.9-.1 5.9-2.3 10.9-7.3 14.7-5-3.8-7.2-8.8-7.3-14.7 2.3-.1 4.7-1 7.3-2.9Z"/><path d="M12 8v7.5"/></svg>',
    "sd:flame": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3.2c.9 2.8 2.7 4.4 3.9 5.9 1.3 1.6 2 3.1 2 4.7a5.9 5.9 0 0 1-11.8 0c0-2.2 1-3.9 2.2-5.4 0 1.6.6 2.7 1.8 3.3.1-3.2.8-5.7 1.9-8.5Z"/></svg>',
    "sd:moon": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20 14.5A8.5 8.5 0 1 1 9.5 4a7 7 0 0 0 10.5 10.5Z"/></svg>',
    // Lucide line set (ISC license) — the same family as the nav icons, so the
    // coach's day-icon picks match the app's icon language. 24px grid, 2px
    // round strokes, currentColor. Stored as "lu:<name>" tokens.
    "lu:dumbbell": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17.596 12.768a2 2 0 1 0 2.829-2.829l-1.768-1.767a2 2 0 0 0 2.828-2.829l-2.828-2.828a2 2 0 0 0-2.829 2.828l-1.767-1.768a2 2 0 1 0-2.829 2.829z"/><path d="m2.5 21.5 1.4-1.4"/><path d="m20.1 3.9 1.4-1.4"/><path d="M5.343 21.485a2 2 0 1 0 2.829-2.828l1.767 1.768a2 2 0 1 0 2.829-2.829l-6.364-6.364a2 2 0 1 0-2.829 2.829l1.768 1.767a2 2 0 0 0-2.828 2.829z"/><path d="m9.6 14.4 4.8-4.8"/></svg>',
    "lu:biceps": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12.409 13.017A5 5 0 0 1 22 15c0 3.866-4 7-9 7-4.077 0-8.153-.82-10.371-2.462-.426-.316-.631-.832-.62-1.362C2.118 12.723 2.627 2 10 2a3 3 0 0 1 3 3 2 2 0 0 1-2 2c-1.105 0-1.64-.444-2-1"/><path d="M15 14a5 5 0 0 0-7.584 2"/><path d="M9.964 6.825C8.019 7.977 9.5 13 8 15"/></svg>',
    "lu:flame": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3q1 4 4 6.5t3 5.5a1 1 0 0 1-14 0 5 5 0 0 1 1-3 1 1 0 0 0 5 0c0-2-1.5-3-1.5-5q0-2 2.5-4"/></svg>',
    "lu:zap": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 14a1 1 0 0 1-.78-1.63l9.9-10.2a.5.5 0 0 1 .86.46l-1.92 6.02A1 1 0 0 0 13 10h7a1 1 0 0 1 .78 1.63l-9.9 10.2a.5.5 0 0 1-.86-.46l1.92-6.02A1 1 0 0 0 11 14z"/></svg>',
    "lu:activity": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 12h-2.48a2 2 0 0 0-1.93 1.46l-2.35 8.36a.25.25 0 0 1-.48 0L9.24 2.18a.25.25 0 0 0-.48 0l-2.35 8.36A2 2 0 0 1 4.49 12H2"/></svg>',
    "lu:mountain": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m8 3 4 8 5-5 5 15H2L8 3z"/></svg>',
    "lu:bone": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M17 10c.7-.7 1.69 0 2.5 0a2.5 2.5 0 1 0 0-5 .5.5 0 0 1-.5-.5 2.5 2.5 0 1 0-5 0c0 .81.7 1.8 0 2.5l-7 7c-.7.7-1.69 0-2.5 0a2.5 2.5 0 0 0 0 5c.28 0 .5.22.5.5a2.5 2.5 0 1 0 5 0c0-.81-.7-1.8 0-2.5Z"/></svg>',
    "lu:gauge": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m12 14 4-4"/><path d="M3.34 19a10 10 0 1 1 17.32 0"/></svg>',
    "lu:heart": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 9.5a5.5 5.5 0 0 1 9.591-3.676.56.56 0 0 0 .818 0A5.49 5.49 0 0 1 22 9.5c0 2.29-1.5 4-3 5.5l-5.492 5.313a2 2 0 0 1-3 .019L5 15c-1.5-1.5-3-3.2-3-5.5"/><path d="M3.22 13H9.5l.5-1 2 4.5 2-7 1.5 3.5h5.27"/></svg>',
    "lu:footprints": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 16v-2.38C4 11.5 2.97 10.5 3 8c.03-2.72 1.49-6 4.5-6C9.37 2 10 3.8 10 5.5c0 3.11-2 5.66-2 8.68V16a2 2 0 1 1-4 0Z"/><path d="M20 20v-2.38c0-2.12 1.03-3.12 1-5.62-.03-2.72-1.49-6-4.5-6C14.63 6 14 7.8 14 9.5c0 3.11 2 5.66 2 8.68V20a2 2 0 1 0 4 0Z"/><path d="M16 17h4"/><path d="M4 13h4"/></svg>',
    "lu:bike": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="18.5" cy="17.5" r="3.5"/><circle cx="5.5" cy="17.5" r="3.5"/><circle cx="15" cy="5" r="1"/><path d="M12 17.5V14l-3-3 4-3 2 3h2"/></svg>',
    "lu:peak": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m8 3 4 8 5-5 5 15H2L8 3z"/><path d="M4.14 15.08c2.62-1.57 5.24-1.43 7.86.42 2.74 1.94 5.49 2 8.23.19"/></svg>',
    "lu:wind": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12.8 19.6A2 2 0 1 0 14 16H2"/><path d="M17.5 8a2.5 2.5 0 1 1 2 4H2"/><path d="M9.8 4.4A2 2 0 1 1 11 8H2"/></svg>',
    "lu:timer": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><line x1="10" x2="14" y1="2" y2="2"/><line x1="12" x2="15" y1="14" y2="11"/><circle cx="12" cy="14" r="8"/></svg>',
    "lu:alarm": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="13" r="8"/><path d="M12 9v4l2 2"/><path d="M5 3 2 6"/><path d="m22 6-3-3"/><path d="M6.38 18.7 4 21"/><path d="M17.64 18.67 20 21"/></svg>',
    "lu:apple": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 6.528V3a1 1 0 0 1 1-1h0"/><path d="M18.237 21A15 15 0 0 0 22 11a6 6 0 0 0-10-4.472A6 6 0 0 0 2 11a15.1 15.1 0 0 0 3.763 10 3 3 0 0 0 3.648.648 5.5 5.5 0 0 1 5.178 0A3 3 0 0 0 18.237 21"/></svg>',
    "lu:banana": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 13c3.5-2 8-2 10 2a5.5 5.5 0 0 1 8 5"/><path d="M5.15 17.89c5.52-1.52 8.65-6.89 7-12C11.55 4 11.5 2 13 2c3.22 0 5 5.5 5 8 0 6.5-4.2 12-10.49 12C5.11 22 2 22 2 20c0-1.5 1.14-1.55 3.15-2.11Z"/></svg>',
    "lu:grape": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M22 5V2l-5.89 5.89"/><circle cx="16.6" cy="15.89" r="3"/><circle cx="8.11" cy="7.4" r="3"/><circle cx="12.35" cy="11.65" r="3"/><circle cx="13.91" cy="5.85" r="3"/><circle cx="18.15" cy="10.09" r="3"/><circle cx="6.56" cy="13.2" r="3"/><circle cx="10.8" cy="17.44" r="3"/><circle cx="5" cy="19" r="3"/></svg>',
    "lu:carrot": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 16a1 1 0 0 0-7-7q-4 4-5.987 12.385a.5.5 0 0 0 .602.602Q11 20 15 16l-3-3"/><path d="M15 9q4 4 7 0-3-4-7 0 4-4 0-7-4 3 0 7"/><path d="m8 15-2.58-2.58"/></svg>',
    "lu:wheat": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 22 16 8"/><path d="M3.47 12.53 5 11l1.53 1.53a3.5 3.5 0 0 1 0 4.94L5 19l-1.53-1.53a3.5 3.5 0 0 1 0-4.94Z"/><path d="M7.47 8.53 9 7l1.53 1.53a3.5 3.5 0 0 1 0 4.94L9 15l-1.53-1.53a3.5 3.5 0 0 1 0-4.94Z"/><path d="M11.47 4.53 13 3l1.53 1.53a3.5 3.5 0 0 1 0 4.94L13 11l-1.53-1.53a3.5 3.5 0 0 1 0-4.94Z"/><path d="M20 2h2v2a4 4 0 0 1-4 4h-2V6a4 4 0 0 1 4-4Z"/><path d="M11.47 17.47 13 19l-1.53 1.53a3.5 3.5 0 0 1-4.94 0L5 19l1.53-1.53a3.5 3.5 0 0 1 4.94 0Z"/><path d="M15.47 13.47 17 15l-1.53 1.53a3.5 3.5 0 0 1-4.94 0L9 15l1.53-1.53a3.5 3.5 0 0 1 4.94 0Z"/><path d="M19.47 9.47 21 11l-1.53 1.53a3.5 3.5 0 0 1-4.94 0L13 11l1.53-1.53a3.5 3.5 0 0 1 4.94 0Z"/></svg>',
    "lu:egg": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 2C8 2 4 8 4 14a8 8 0 0 0 16 0c0-6-4-12-8-12"/></svg>',
    "lu:beef": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M16.4 13.7A6.5 6.5 0 1 0 6.28 6.6c-1.1 3.13-.78 3.9-3.18 6.08A3 3 0 0 0 5 18c4 0 8.4-1.8 11.4-4.3"/><path d="m18.5 6 2.19 4.5a6.48 6.48 0 0 1-2.29 7.2C15.4 20.2 11 22 7 22a3 3 0 0 1-2.68-1.66L2.4 16.5"/><circle cx="12.5" cy="8.5" r="2.5"/></svg>',
    "lu:fish": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M6.5 12c.94-3.46 4.94-6 8.5-6 3.56 0 6.06 2.54 7 6-.94 3.47-3.44 6-7 6s-7.56-2.53-8.5-6Z"/><path d="M18 12v.5"/><path d="M16 17.93a9.77 9.77 0 0 1 0-11.86"/><path d="M7 10.67C7 8 5.58 5.97 2.73 5.5c-1 1.5-1 5 .23 6.5-1.24 1.5-1.24 5-.23 6.5C5.58 18.03 7 16 7 13.33"/><path d="M10.46 7.26C10.2 5.88 9.17 4.24 8 3h5.8a2 2 0 0 1 1.98 1.67l.23 1.4"/><path d="m16.01 17.93-.23 1.4A2 2 0 0 1 13.8 21H9.5a5.96 5.96 0 0 0 1.49-3.98"/></svg>',
    "lu:salad": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7 21h10"/><path d="M12 21a9 9 0 0 0 9-9H3a9 9 0 0 0 9 9Z"/><path d="M11.38 12a2.4 2.4 0 0 1-.4-4.77 2.4 2.4 0 0 1 3.2-2.77 2.4 2.4 0 0 1 3.47-.63 2.4 2.4 0 0 1 3.37 3.37 2.4 2.4 0 0 1-1.1 3.7 2.51 2.51 0 0 1 .03 1.1"/><path d="m13 12 4-4"/><path d="M10.9 7.25A3.99 3.99 0 0 0 4 10c0 .73.2 1.41.54 2"/></svg>',
    "lu:drumstick": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15.4 15.63a7.875 6 135 1 1 6.23-6.23 4.5 3.43 135 0 0-6.23 6.23"/><path d="m8.29 12.71-2.6 2.6a2.5 2.5 0 1 0-1.65 4.65A2.5 2.5 0 1 0 8.7 18.3l2.59-2.59"/></svg>',
    "lu:sandwich": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m2.37 11.223 8.372-6.777a2 2 0 0 1 2.516 0l8.371 6.777"/><path d="M21 15a1 1 0 0 1 1 1v2a1 1 0 0 1-1 1h-5.25"/><path d="M3 15a1 1 0 0 0-1 1v2a1 1 0 0 0 1 1h9"/><path d="m6.67 15 6.13 4.6a2 2 0 0 0 2.8-.4l3.15-4.2"/><rect width="20" height="4" x="2" y="11" rx="1"/></svg>',
    "lu:coffee": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 2v2"/><path d="M14 2v2"/><path d="M16 8a1 1 0 0 1 1 1v8a4 4 0 0 1-4 4H7a4 4 0 0 1-4-4V9a1 1 0 0 1 1-1h14a4 4 0 1 1 0 8h-1"/><path d="M6 2v2"/></svg>',
    "lu:shake": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m6 8 1.75 12.28a2 2 0 0 0 2 1.72h4.54a2 2 0 0 0 2-1.72L18 8"/><path d="M5 8h14"/><path d="M7 15a6.47 6.47 0 0 1 5 0 6.47 6.47 0 0 0 5 0"/><path d="m12 8 1-6h2"/></svg>',
    "lu:water": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5.116 4.104A1 1 0 0 1 6.11 3h11.78a1 1 0 0 1 .994 1.105L17.19 20.21A2 2 0 0 1 15.2 22H8.8a2 2 0 0 1-2-1.79z"/><path d="M6 12a5 5 0 0 1 6 0 5 5 0 0 0 6 0"/></svg>',
    "lu:droplet": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 22a7 7 0 0 0 7-7c0-2-1-3.9-3-5.5s-3.5-4-4-6.5c-.5 2.5-2 4.9-4 6.5C6 11.1 5 13 5 15a7 7 0 0 0 7 7z"/></svg>',
    "lu:battery": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m11 7-3 5h4l-3 5"/><path d="M14.856 6H16a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2h-2.935"/><path d="M22 14v-4"/><path d="M5.14 18H4a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h2.936"/></svg>',
    "lu:bed": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 4v16"/><path d="M2 8h18a2 2 0 0 1 2 2v10"/><path d="M2 17h20"/><path d="M6 8v9"/></svg>',
    "lu:moon": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M20.985 12.486a9 9 0 1 1-9.473-9.472c.405-.022.617.46.402.803a6 6 0 0 0 8.268 8.268c.344-.215.825-.004.803.401"/></svg>',
    "lu:sun": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.93 4.93 1.41 1.41"/><path d="m17.66 17.66 1.41 1.41"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.34 17.66-1.41 1.41"/><path d="m19.07 4.93-1.41 1.41"/></svg>',
    "lu:brain": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 18V5"/><path d="M15 13a4.17 4.17 0 0 1-3-4 4.17 4.17 0 0 1-3 4"/><path d="M17.598 6.5A3 3 0 1 0 12 5a3 3 0 1 0-5.598 1.5"/><path d="M17.997 5.125a4 4 0 0 1 2.526 5.77"/><path d="M18 18a4 4 0 0 0 2-7.464"/><path d="M19.967 17.483A4 4 0 1 1 12 18a4 4 0 1 1-7.967-.517"/><path d="M6 18a4 4 0 0 1-2-7.464"/><path d="M6.003 5.125a4 4 0 0 0-2.526 5.77"/></svg>',
    "lu:trophy": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M10 14.66v1.626a2 2 0 0 1-.976 1.696A5 5 0 0 0 7 21.978"/><path d="M14 14.66v1.626a2 2 0 0 0 .976 1.696A5 5 0 0 1 17 21.978"/><path d="M18 9h1.5a1 1 0 0 0 0-5H18"/><path d="M4 22h16"/><path d="M6 9a6 6 0 0 0 12 0V3a1 1 0 0 0-1-1H7a1 1 0 0 0-1 1z"/><path d="M6 9H4.5a1 1 0 0 1 0-5H6"/></svg>',
    "lu:medal": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M7.21 15 2.66 7.14a2 2 0 0 1 .13-2.2L4.4 2.8A2 2 0 0 1 6 2h12a2 2 0 0 1 1.6.8l1.6 2.14a2 2 0 0 1 .14 2.2L16.79 15"/><path d="M11 12 5.12 2.2"/><path d="m13 12 5.88-9.8"/><path d="M8 7h8"/><circle cx="12" cy="17" r="5"/><path d="M12 18v-2h-.5"/></svg>',
    "lu:award": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m15.477 12.89 1.515 8.526a.5.5 0 0 1-.81.47l-3.58-2.687a1 1 0 0 0-1.197 0l-3.586 2.686a.5.5 0 0 1-.81-.469l1.514-8.526"/><circle cx="12" cy="8" r="6"/></svg>',
    "lu:target": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="10"/><circle cx="12" cy="12" r="6"/><circle cx="12" cy="12" r="2"/></svg>',
    "lu:flag": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M4 22V4a1 1 0 0 1 .4-.8A6 6 0 0 1 8 2c3 0 5 2 7.333 2q2 0 3.067-.8A1 1 0 0 1 20 4v10a1 1 0 0 1-.4.8A6 6 0 0 1 16 16c-3 0-5-2-8-2a6 6 0 0 0-4 1.528"/></svg>',
    "lu:crown": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11.562 3.266a.5.5 0 0 1 .876 0L15.39 8.87a1 1 0 0 0 1.516.294L21.183 5.5a.5.5 0 0 1 .798.519l-2.834 10.246a1 1 0 0 1-.956.734H5.81a1 1 0 0 1-.957-.734L2.02 6.02a.5.5 0 0 1 .798-.519l4.276 3.664a1 1 0 0 0 1.516-.294z"/><path d="M5 21h14"/></svg>',
    "lu:star": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11.525 2.295a.53.53 0 0 1 .95 0l2.31 4.679a2.123 2.123 0 0 0 1.595 1.16l5.166.756a.53.53 0 0 1 .294.904l-3.736 3.638a2.123 2.123 0 0 0-.611 1.878l.882 5.14a.53.53 0 0 1-.771.56l-4.618-2.428a2.122 2.122 0 0 0-1.973 0L6.396 21.01a.53.53 0 0 1-.77-.56l.881-5.139a2.122 2.122 0 0 0-.611-1.879L2.16 9.795a.53.53 0 0 1 .294-.906l5.165-.755a2.122 2.122 0 0 0 1.597-1.16z"/></svg>',
    "lu:sparkles": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M11.017 2.814a1 1 0 0 1 1.966 0l1.051 5.558a2 2 0 0 0 1.594 1.594l5.558 1.051a1 1 0 0 1 0 1.966l-5.558 1.051a2 2 0 0 0-1.594 1.594l-1.051 5.558a1 1 0 0 1-1.966 0l-1.051-5.558a2 2 0 0 0-1.594-1.594l-5.558-1.051a1 1 0 0 1 0-1.966l5.558-1.051a2 2 0 0 0 1.594-1.594z"/><path d="M20 2v4"/><path d="M22 4h-4"/><circle cx="4" cy="20" r="2"/></svg>',
    "lu:rocket": '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 15v5s3.03-.55 4-2c1.08-1.62 0-5 0-5"/><path d="M4.5 16.5c-1.5 1.26-2 5-2 5s3.74-.5 5-2c.71-.84.7-2.13-.09-2.91a2.18 2.18 0 0 0-2.91-.09"/><path d="M9 12a22 22 0 0 1 2-3.95A12.88 12.88 0 0 1 22 2c0 2.72-.78 7.5-6 11a22.4 22.4 0 0 1-4 2z"/><path d="M9 12H4s.55-3.03 2-4c1.62-1.08 5 .05 5 .05"/></svg>',
  };
  function isSvgIcon(v) { return typeof v === "string" && Object.prototype.hasOwnProperty.call(DAY_ICON_SVGS, v); }
  function dayIconHtml(v) { return isSvgIcon(v) ? DAY_ICON_SVGS[v] : escapeHtml(v || ""); }
  function setDayIcon(el, v) { if (isSvgIcon(v)) el.innerHTML = DAY_ICON_SVGS[v]; else el.textContent = v || ""; }

  const DAY_ICON_CATEGORIES = [
    { label: "Stone Dragon", icons: [
      "sd:claw","sd:talon","sd:press","sd:mountain","sd:scale","sd:flame","sd:moon",
    ] },
    // Lucide line categories — the app's icon language (same family as the nav).
    // These lead the picker so day icons read as one cohesive set.
    { label: "Strength", icons: [
      "lu:dumbbell","lu:biceps","lu:flame","lu:zap","lu:activity","lu:mountain","lu:bone","lu:gauge",
    ] },
    { label: "Cardio", icons: [
      "lu:heart","lu:footprints","lu:bike","lu:peak","lu:wind","lu:timer","lu:alarm",
    ] },
    { label: "Nutrition", icons: [
      "lu:apple","lu:banana","lu:grape","lu:carrot","lu:wheat","lu:egg","lu:beef","lu:fish","lu:salad","lu:drumstick","lu:sandwich",
    ] },
    { label: "Recovery", icons: [
      "lu:coffee","lu:shake","lu:water","lu:droplet","lu:battery","lu:bed","lu:moon","lu:sun","lu:brain",
    ] },
    { label: "Wins", icons: [
      "lu:trophy","lu:medal","lu:award","lu:target","lu:flag","lu:crown","lu:star","lu:sparkles","lu:rocket",
    ] },
    { label: "Equipment", icons: [
      "eq:barbell","eq:dumbbell","eq:kettlebell","eq:plate","eq:bench","eq:rack","eq:pullup","eq:medball",
    ] },
    // Emoji categories kept for flavor / brand fun where line icons don't reach.
    { label: "Dragons", icons: [
      "🐉","🐲","🦖","🦕","🔥","⚡","🌋","💥","⭐","🌟","✨","🛡️","⚔️","🗡️","🏹",
      "🔮","💎","👑","🦄","🐍","🦂","🕷️","🦇","👹","👺","💀","☠️","🧙","🧙‍♂️","🧝",
    ] },
    { label: "Sport", icons: [
      "⚽","🏀","🏈","⚾","🥎","🎾","🏐","🏉","🥏","🎳","🏏","🏑","🏒","🥍","🏓",
      "🏸","🪀","🪁","🎱","🥊","🥋","🏹","🎣","🛶","⛳","🏌️","🏌️‍♂️","🏌️‍♀️","🎿","🪃",
    ] },
    { label: "Vibes", icons: [
      "👊","🤜","🤛","✊","🙌","👏","💯","💥","🎉","🎊","🥳","😤","😅","💦","🌊",
      "🌪️","☀️","🌙","🧠","🫀",
    ] },
  ];

  function openIconPicker(currentVal, cb, anchorEl) {
    document.querySelector(".grid-picker-pop")?.remove();
    const pop = document.createElement("div");
    pop.className = "grid-picker-pop grid-picker-pop-icon";
    pop.style.cssText = "position:fixed;z-index:9999;visibility:hidden";

    const tabs = document.createElement("div");
    tabs.className = "grid-picker-tabs";
    const grid = document.createElement("div");
    grid.className = "grid-picker-grid icon-picker-grid";
    grid.style.gridTemplateColumns = "repeat(6, 1fr)";

    let activeCat = DAY_ICON_CATEGORIES.findIndex((c) => c.icons.includes(currentVal));
    if (activeCat < 0) activeCat = 0;

    function showCat(idx) {
      activeCat = idx;
      tabs.querySelectorAll(".grid-picker-tab").forEach((t, i) => t.classList.toggle("active", i === idx));
      grid.innerHTML = "";
      DAY_ICON_CATEGORIES[idx].icons.forEach((ic) => {
        const btn = document.createElement("button");
        btn.className = "grid-picker-cell icon-picker-cell" + (ic === currentVal ? " active" : "");
        setDayIcon(btn, ic);
        btn.type = "button";
        btn.addEventListener("click", () => { pop.remove(); cb(ic); });
        grid.appendChild(btn);
      });
      requestAnimationFrame(() => _positionPop(pop, anchorEl));
    }

    DAY_ICON_CATEGORIES.forEach((c, i) => {
      const tab = document.createElement("button");
      tab.className = "grid-picker-tab";
      tab.textContent = c.label;
      tab.type = "button";
      tab.addEventListener("click", () => showCat(i));
      tabs.appendChild(tab);
    });

    pop.appendChild(tabs);
    pop.appendChild(grid);
    document.body.appendChild(pop);
    showCat(activeCat);
    _attachOutsideClose(pop, anchorEl);
  }

  function openWeightPicker(currentVal, cb, anchorEl) {
    document.querySelector(".grid-picker-pop")?.remove();
    const pop = document.createElement("div");
    pop.className = "grid-picker-pop grid-picker-pop-weight";
    pop.style.cssText = "position:fixed;z-index:9999;visibility:hidden";

    const tabs = document.createElement("div");
    tabs.className = "grid-picker-tabs";
    const grid = document.createElement("div");
    grid.className = "grid-picker-grid";
    grid.style.gridTemplateColumns = "repeat(5, 1fr)";

    let activeRange = 0;
    if (currentVal && currentVal !== "BW" && currentVal !== "BAR") {
      const n = parseInt(currentVal, 10);
      if (n > 400) activeRange = 5;
      else if (n > 300) activeRange = 4;
      else if (n > 200) activeRange = 3;
      else if (n > 100) activeRange = 2;
      else activeRange = 1;
    }

    function showRange(idx) {
      activeRange = idx;
      tabs.querySelectorAll(".grid-picker-tab").forEach((t, i) => t.classList.toggle("active", i === idx));
      grid.innerHTML = "";
      const { values } = WEIGHT_RANGES[idx];
      values.forEach(v => {
        const btn = document.createElement("button");
        btn.className = "grid-picker-cell" + (String(v) === String(currentVal) ? " active" : "");
        btn.textContent = v === "BW" ? "BW" : v === "BAR" ? "BAR" : v + " lb";
        btn.type = "button";
        btn.addEventListener("click", () => { pop.remove(); cb(String(v)); });
        grid.appendChild(btn);
      });
      requestAnimationFrame(() => _positionPop(pop, anchorEl));
    }

    WEIGHT_RANGES.forEach((r, i) => {
      const tab = document.createElement("button");
      tab.className = "grid-picker-tab";
      tab.textContent = r.label;
      tab.type = "button";
      tab.addEventListener("click", () => showRange(i));
      tabs.appendChild(tab);
    });

    pop.appendChild(tabs);
    pop.appendChild(grid);
    document.body.appendChild(pop);
    showRange(activeRange);
    _attachOutsideClose(pop, anchorEl);
  }

  // -------- Weeks/program --------
  function renderWeeks() {
    if (_programEditorId) {
      const tpl = currentProgramTemplate(); if (!tpl) return;
      const container = $("#program-editor-weeks");
      const empty = $("#program-editor-empty");
      container.innerHTML = "";
      if (!tpl.weeks.length) { show(empty); return; }
      hide(empty);
      _coachActiveWeekIdx = Math.min(_coachActiveWeekIdx, tpl.weeks.length - 1);
      renderCoachWeekTabs(tpl.weeks, container);
      return;
    }
    const c = currentClient(); if (!c) return;
    const container = $("#weeks-container");
    const empty = $("#weeks-empty");
    container.innerHTML = "";
    // One-off sessions render even with no program loaded — throwing a day
    // together mustn't require weeks to exist.
    if (c.weeks.length === 0) { show(empty); renderOneOffSection(c); return; }
    hide(empty);
    _coachActiveWeekIdx = Math.min(_coachActiveWeekIdx, c.weeks.length - 1);
    renderCoachWeekTabs(c.weeks, container);
    renderMoodRollupBanner(c, container);
    renderArchiveSection(c);
    renderOneOffSection(c);
  }
  // Compact "how they've been feeling" roll-up above the athlete's program.
  function renderMoodRollupBanner(c, container) {
    if (!container) return;
    const roll = moodRollup(c);
    if (!roll.length) return;
    const banner = document.createElement("div");
    banner.className = "mood-rollup";
    banner.innerHTML = `<span class="mood-rollup-lbl">🫀 Program mood</span>` +
      roll.map((m) => `<span class="mood-rollup-item" title="${escapeHtml(m.label)}"><span class="mood-emo">${m.emoji}</span><span class="mood-rollup-n">${m.n}</span></span>`).join("");
    container.insertBefore(banner, container.firstChild);
  }

  // -------- One-off coach sessions (coach side) --------
  // Extra dated days the coach runs with the athlete (heavy days, thrown-
  // together days). They live in c.oneOffDays, never in weeks, so program
  // progression / week nav / up-next don't see them. PR detection does.
  const _oneOffOpen = new Set(); // session ids expanded in this session
  function renderOneOffSection(c) {
    const container = $("#oneoff-container");
    if (!container) return;
    if (!Array.isArray(c.oneOffDays)) c.oneOffDays = [];
    container.innerHTML = "";
    const rerender = () => renderOneOffSection(c);

    const section = document.createElement("div");
    section.className = "card oneoff-section";
    const head = document.createElement("div");
    head.className = "oneoff-head";
    const intro = document.createElement("div");
    intro.className = "oneoff-head-text";
    intro.innerHTML = `<h3>🐉 One-off sessions</h3><p class="muted oneoff-hint">Days you run together outside the program: heavy lifts with your equipment, or a thrown-together day. The program never sees them, PRs do.</p>`;
    const actions = document.createElement("div");
    actions.className = "oneoff-head-actions";

    const addBtn = document.createElement("button");
    addBtn.className = "btn btn-primary btn-sm";
    addBtn.textContent = "＋ New session";
    addBtn.addEventListener("click", () => {
      const day = { id: uid(), date: todayISO(), name: "Coach session", icon: "🐉", exercises: [] };
      c.oneOffDays.push(day);
      _oneOffOpen.add(day.id);
      saveTrainer(); rerender();
    });
    actions.appendChild(addBtn);

    // Repeat the most recent session that has exercises — twice-a-month heavy
    // days are usually the same handful of lifts.
    const src = [...c.oneOffDays]
      .filter((d) => (d.exercises || []).length)
      .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")))[0];
    if (src) {
      const dupBtn = document.createElement("button");
      dupBtn.className = "btn btn-ghost btn-sm";
      dupBtn.textContent = "⧉ Repeat last";
      dupBtn.title = `Copy "${src.name}" (${src.date || "no date"}) into a new session dated today`;
      dupBtn.addEventListener("click", () => {
        const day = {
          id: uid(), date: todayISO(), name: src.name, icon: src.icon || "🐉",
          exercises: (src.exercises || []).map((e) => ({ ...structuredClone(e), id: uid() })),
        };
        c.oneOffDays.push(day);
        _oneOffOpen.add(day.id);
        saveTrainer(); rerender();
        toast("Session copied. Set the date and tweak the lifts.");
      });
      actions.appendChild(dupBtn);
    }

    head.appendChild(intro);
    head.appendChild(actions);
    section.appendChild(head);

    const logs = c.importedProgress?.exerciseLogs || {};
    const sessionLogged = (day) =>
      (day.exercises || []).length &&
      day.exercises.every((ex) => (logs[ex.id] || []).some((l) => l.locked !== false));

    [...c.oneOffDays]
      .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")))
      .forEach((day) => {
        const card = document.createElement("details");
        card.className = "oneoff-card";
        card.open = _oneOffOpen.has(day.id);
        card.addEventListener("toggle", () => {
          if (card.open) _oneOffOpen.add(day.id); else _oneOffOpen.delete(day.id);
        });
        const summary = document.createElement("summary");
        summary.className = "oneoff-summary";
        const nEx = (day.exercises || []).length;
        const dateLbl = day.date
          ? new Date(day.date + "T12:00:00").toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })
          : "No date";
        summary.innerHTML = `
          <span class="oneoff-date">${escapeHtml(dateLbl)}</span>
          <span class="oneoff-name">${escapeHtml(day.name || "Coach session")}</span>
          <span class="oneoff-meta">${nEx} exercise${nEx === 1 ? "" : "s"}${sessionLogged(day) ? ` · <span class="oneoff-logged">logged ✓</span>` : ""}</span>`;
        card.appendChild(summary);

        const body = document.createElement("div");
        body.className = "oneoff-body";

        const meta = document.createElement("div");
        meta.className = "oneoff-meta-row";
        const dateInput = document.createElement("input");
        dateInput.type = "date";
        dateInput.className = "oneoff-date-input";
        dateInput.value = day.date || "";
        dateInput.title = "When you're running this session";
        dateInput.addEventListener("change", () => { day.date = dateInput.value || todayISO(); saveTrainer(); rerender(); });
        const delBtn = document.createElement("button");
        delBtn.className = "btn btn-ghost btn-xs";
        delBtn.style.color = "var(--danger)";
        delBtn.textContent = "✕ Delete session";
        delBtn.addEventListener("click", () => {
          if (!window.confirm(`Delete "${day.name || "this session"}"? The athlete's logged numbers stay in their history.`)) return;
          c.oneOffDays = c.oneOffDays.filter((d) => d.id !== day.id);
          _oneOffOpen.delete(day.id);
          saveTrainer(); rerender();
        });
        meta.appendChild(dateInput);
        meta.appendChild(delBtn);
        body.appendChild(meta);

        // The full day editor (name, icon, library drag/drop, quick-add) —
        // the session doubles as a day; the shim week is only used by the
        // editor's delete button, which is hidden here.
        body.appendChild(renderDayContent({ id: "oneoff", days: c.oneOffDays }, day, rerender, { hideDelete: true }));
        card.appendChild(body);
        section.appendChild(card);
      });

    if (!c.oneOffDays.length) {
      const emptyHint = document.createElement("p");
      emptyHint.className = "muted oneoff-empty";
      emptyHint.textContent = "No one-off sessions yet.";
      section.appendChild(emptyHint);
    }
    container.appendChild(section);
  }

  function renderCoachWeekTabs(weeks, container, showAdd = true) {
    // ── Tab strip ──
    const strip = document.createElement("div");
    strip.className = "coach-week-tab-strip";

    let weekDragFrom = null; // drag-to-reorder weeks (mirrors the day-tab pattern)

    weeks.forEach((week, wIdx) => {
      const tab = document.createElement("button");
      tab.className = "coach-week-tab" + (wIdx === _coachActiveWeekIdx ? " active" : "");
      tab.title = "Drag to reorder";
      const lbl = document.createElement("span");
      lbl.className = "coach-week-tab-lbl";
      lbl.textContent = week.phaseLabel ? `${week.phaseLabel} ${week.label}` : week.label;
      const dup = document.createElement("button");
      dup.className = "coach-week-tab-dup";
      dup.textContent = "⧉";
      dup.title = `Duplicate ${week.label}`;
      dup.addEventListener("click", (e) => {
        e.stopPropagation();
        const list = _programEditorId ? currentProgramTemplate()?.weeks : currentClient()?.weeks;
        if (!list) return;
        if (list.length >= 12) { toast("12-week maximum reached"); return; }
        const originalLabel = week.label;
        const clone = {
          ...week,
          id: uid(),
          days: (week.days || []).map((day) => ({
            ...day,
            id: uid(),
            exercises: (day.exercises || []).map((ex) => ({ ...ex, id: uid() })),
          })),
        };
        list.splice(wIdx + 1, 0, clone);
        list.forEach((w, i) => { if (/^Week \d+$/.test(w.label)) w.label = `Week ${i + 1}`; });
        _coachActiveWeekIdx = wIdx + 1;
        saveTrainer();
        renderWeeks();
        if (!_programEditorId) { renderDiet(); renderCoachCalendar(); }
        toast(`Duplicated ${originalLabel}`);
      });

      const del = document.createElement("button");
      del.className = "coach-week-tab-del";
      del.textContent = "×";
      del.title = `Delete ${week.label}`;
      if (wIdx === 0) del.style.display = "none";
      del.addEventListener("click", (e) => {
        e.stopPropagation();
        if (!window.confirm(`Delete ${week.label}?`)) return;
        if (_programEditorId) {
          const tpl = currentProgramTemplate(); if (!tpl) return;
          tpl.weeks.splice(wIdx, 1);
          tpl.weeks.forEach((w, i) => { if (/^Week \d+$/.test(w.label)) w.label = `Week ${i + 1}`; });
        } else {
          const c = currentClient(); if (!c) return;
          c.weeks.splice(wIdx, 1);
          c.weeks.forEach((w, i) => { if (/^Week \d+$/.test(w.label)) w.label = `Week ${i + 1}`; });
        }
        if (_coachActiveWeekIdx >= weeks.length - 1) _coachActiveWeekIdx = Math.max(0, weeks.length - 2);
        saveTrainer();
        renderWeeks();
        if (!_programEditorId) { renderDiet(); renderCoachCalendar(); }
      });
      tab.appendChild(lbl);
      tab.appendChild(dup);
      tab.appendChild(del);
      tab.addEventListener("click", () => {
        _coachActiveWeekIdx = wIdx;
        renderWeeks();
      });

      // Drag to reorder weeks within the program.
      tab.draggable = true;
      tab.addEventListener("dragstart", (e) => {
        weekDragFrom = wIdx;
        tab.classList.add("coach-week-tab-dragging");
        e.dataTransfer.effectAllowed = "move";
        try { e.dataTransfer.setData("text/plain", String(wIdx)); } catch (_) {}
      });
      tab.addEventListener("dragend", () => {
        weekDragFrom = null;
        strip.querySelectorAll(".coach-week-tab").forEach((t) => t.classList.remove("coach-week-tab-dragover", "coach-week-tab-dragging"));
      });
      tab.addEventListener("dragover", (e) => {
        if (weekDragFrom === null || weekDragFrom === wIdx) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        tab.classList.add("coach-week-tab-dragover");
      });
      tab.addEventListener("dragleave", () => tab.classList.remove("coach-week-tab-dragover"));
      tab.addEventListener("drop", (e) => {
        e.preventDefault();
        if (weekDragFrom === null || weekDragFrom === wIdx) return;
        const list = _programEditorId ? currentProgramTemplate()?.weeks : currentClient()?.weeks;
        if (!list) return;
        // Keep the same week active after the shuffle by tracking its id.
        const activeId = list[_coachActiveWeekIdx] && list[_coachActiveWeekIdx].id;
        const [moved] = list.splice(weekDragFrom, 1);
        list.splice(wIdx, 0, moved);
        // Default "Week N" labels follow position; custom/phase labels are left alone.
        list.forEach((w, i) => { if (/^Week \d+$/.test(w.label)) w.label = `Week ${i + 1}`; });
        const newActive = list.findIndex((w) => w.id === activeId);
        _coachActiveWeekIdx = newActive >= 0 ? newActive : wIdx;
        weekDragFrom = null;
        saveTrainer();
        renderWeeks();
        if (!_programEditorId) { renderDiet(); renderCoachCalendar(); }
      });

      strip.appendChild(tab);
    });

    if (showAdd && weeks.length < 12) {
      const addBtn = document.createElement("button");
      addBtn.className = "coach-week-tab coach-week-tab-add";
      addBtn.textContent = "+";
      addBtn.title = "Add week";
      addBtn.addEventListener("click", () => {
        _coachActiveWeekIdx = weeks.length;
        addWeek();
      });
      strip.appendChild(addBtn);
    }

    container.appendChild(strip);

    // ── Active week body ──
    const week = weeks[_coachActiveWeekIdx];
    if (!week) return;
    const body = document.createElement("div");
    body.className = "coach-week-body";

    // Day tabs (identical logic from old renderWeekCard)
    if (week._activeDayIdx === undefined || week._activeDayIdx >= week.days.length) week._activeDayIdx = 0;
    const tabStrip  = document.createElement("div");
    tabStrip.className = "day-tab-strip";
    const dayContent = document.createElement("div");
    dayContent.className = "day-content-area";

    let dayDragFrom = null;
    function renderDayTabs() {
      tabStrip.innerHTML = "";
      const moodClient = _programEditorId ? null : currentClient();
      week.days.forEach((day, dIdx) => {
        const tab = document.createElement("button");
        tab.className = "day-tab" + (dIdx === week._activeDayIdx ? " active" : "");
        const dm = moodClient ? dayMoods(moodClient.importedProgress, day.id) : [];
        tab.innerHTML = `<span class="day-tab-name">${escapeHtml(day.name || `Day ${dIdx + 1}`)}</span>${dm.length ? moodChipsHtml(dm, true) : ""}`;
        tab.addEventListener("click", () => { week._activeDayIdx = dIdx; renderDayTabs(); renderActiveDayContent(); });
        // Drag to reorder days within the week
        tab.draggable = true;
        tab.addEventListener("dragstart", (e) => {
          dayDragFrom = dIdx;
          tab.classList.add("day-tab-dragging");
          e.dataTransfer.effectAllowed = "move";
          try { e.dataTransfer.setData("text/plain", String(dIdx)); } catch (_) {}
        });
        tab.addEventListener("dragend", () => {
          dayDragFrom = null;
          tabStrip.querySelectorAll(".day-tab").forEach((t) => t.classList.remove("day-tab-dragover", "day-tab-dragging"));
        });
        tab.addEventListener("dragover", (e) => {
          if (dayDragFrom === null || dayDragFrom === dIdx) return;
          e.preventDefault();
          e.dataTransfer.dropEffect = "move";
          tab.classList.add("day-tab-dragover");
        });
        tab.addEventListener("dragleave", () => tab.classList.remove("day-tab-dragover"));
        tab.addEventListener("drop", (e) => {
          e.preventDefault();
          if (dayDragFrom === null || dayDragFrom === dIdx) return;
          const activeId = week.days[week._activeDayIdx] && week.days[week._activeDayIdx].id;
          const [moved] = week.days.splice(dayDragFrom, 1);
          week.days.splice(dIdx, 0, moved);
          const newActive = week.days.findIndex((d) => d.id === activeId);
          week._activeDayIdx = newActive >= 0 ? newActive : dIdx;
          dayDragFrom = null;
          saveTrainer(); renderDayTabs(); renderActiveDayContent();
        });
        tabStrip.appendChild(tab);
      });
      const addDayBtn = document.createElement("button");
      addDayBtn.className = "day-tab day-tab-add";
      addDayBtn.textContent = "+ Day";
      addDayBtn.addEventListener("click", () => {
        week.days.push(makeDay(week.days.length + 1));
        week._activeDayIdx = week.days.length - 1;
        saveTrainer(); renderDayTabs(); renderActiveDayContent();
      });
      tabStrip.appendChild(addDayBtn);

      const importDayBtn = document.createElement("button");
      importDayBtn.className = "day-tab day-tab-add day-tab-import";
      importDayBtn.textContent = "📥 Library";
      importDayBtn.title = "Import a day from your Workout Library";
      importDayBtn.addEventListener("click", () => {
        openImportDayModal(week, () => { renderDayTabs(); renderActiveDayContent(); });
      });
      tabStrip.appendChild(importDayBtn);
    }

    function renderActiveDayContent() {
      dayContent.innerHTML = "";
      if (!week.days.length) {
        const p = document.createElement("p");
        p.className = "muted";
        p.style.cssText = "text-align:center; padding:2.25rem 1.25rem;";
        p.textContent = "No training days yet. Click + Day to add one, or 📥 Library to import a saved day.";
        dayContent.appendChild(p); return;
      }
      const dayIdx = Math.min(week._activeDayIdx, week.days.length - 1);
      const rerender = () => { renderDayTabs(); renderActiveDayContent(); };
      dayContent.appendChild(renderDayContent(week, week.days[dayIdx], rerender));
    }

    renderDayTabs(); renderActiveDayContent();
    body.appendChild(tabStrip);
    body.appendChild(dayContent);
    container.appendChild(body);
  }

  function archiveCurrentProgram() {
    const c = currentClient(); if (!c) return;
    if (!c.weeks || !c.weeks.length) { toast("No program to archive"); return; }
    if (!window.confirm(`Archive the current program for ${c.name}?\n\nThis saves a read-only snapshot you can review later. The current program stays editable.`)) return;
    if (!Array.isArray(c.archivedPrograms)) c.archivedPrograms = [];
    const d = new Date();
    const label = d.toLocaleDateString("en-US", { month: "long", year: "numeric" });
    c.archivedPrograms.unshift({
      id: uid(),
      label: "Archived: " + label,
      archivedAt: d.toISOString(),
      weeks: JSON.parse(JSON.stringify(c.weeks)),
      schedule: JSON.parse(JSON.stringify(c.schedule || {})),
    });
    saveTrainer();
    toast("Program archived ✓");
    renderArchiveSection(c);
  }

  function renderArchiveSection(c) {
    const container = $("#archive-container");
    if (!container) return;
    if (!c || !Array.isArray(c.archivedPrograms) || !c.archivedPrograms.length) {
      container.innerHTML = "";
      return;
    }
    container.innerHTML = "";
    const section = document.createElement("details");
    section.className = "archive-section";
    section.open = false;
    const summary = document.createElement("summary");
    summary.className = "archive-summary";
    summary.textContent = `📁 Program Archive (${c.archivedPrograms.length})`;
    section.appendChild(summary);

    c.archivedPrograms.forEach((prog, pIdx) => {
      const card = document.createElement("div");
      card.className = "archive-prog-card";
      const d = prog.archivedAt ? new Date(prog.archivedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "";
      const exTotal = prog.weeks.reduce((n, w) => n + w.days.reduce((m, d) => m + d.exercises.length, 0), 0);
      const head = document.createElement("div");
      head.className = "archive-prog-head";
      head.innerHTML = `
        <div class="archive-prog-info">
          <span class="archive-prog-label">${escapeHtml(prog.label)}</span>
          <span class="archive-prog-meta">${prog.weeks.length} week${prog.weeks.length === 1 ? "" : "s"} · ${exTotal} exercise${exTotal === 1 ? "" : "s"}${d ? " · saved " + escapeHtml(d) : ""}</span>
        </div>
        <div class="archive-prog-actions">
          <button class="btn btn-ghost btn-xs" data-action="toggle">Expand</button>
          <button class="btn btn-danger btn-xs" data-action="delete">Delete</button>
        </div>`;

      const body = document.createElement("div");
      body.className = "archive-prog-body hidden";
      prog.weeks.forEach((week) => body.appendChild(renderArchiveWeek(week)));

      head.querySelector('[data-action="toggle"]').addEventListener("click", () => {
        const open = body.classList.toggle("hidden");
        head.querySelector('[data-action="toggle"]').textContent = open ? "Expand" : "Collapse";
      });
      head.querySelector('[data-action="delete"]').addEventListener("click", () => {
        if (!window.confirm(`Delete "${prog.label}"? This cannot be undone.`)) return;
        c.archivedPrograms.splice(pIdx, 1);
        saveTrainer();
        renderArchiveSection(c);
      });

      card.appendChild(head);
      card.appendChild(body);
      section.appendChild(card);
    });

    container.appendChild(section);
  }

  function renderArchiveWeek(week, showTagChips = true) {
    const card = document.createElement("div");
    card.className = "archive-week-card";
    const exTotal = week.days.reduce((n, d) => n + d.exercises.length, 0);
    const head = document.createElement("div");
    head.className = "archive-week-head";
    head.innerHTML = `
      <span class="archive-week-label">${week.phaseLabel ? `<span class="phase-badge">${escapeHtml(week.phaseLabel)}</span> ` : ""}${escapeHtml(week.label)}${week.focus ? " · " + escapeHtml(week.focus) : ""}</span>
      <span class="archive-week-meta">${week.days.length} day${week.days.length === 1 ? "" : "s"} · ${exTotal} exercise${exTotal === 1 ? "" : "s"}</span>`;
    card.appendChild(head);
    week.days.forEach((day) => {
      const dayEl = document.createElement("div");
      dayEl.className = "archive-day";
      const dayHead = document.createElement("div");
      dayHead.className = "archive-day-name";
      dayHead.textContent = day.name || "Day";
      dayEl.appendChild(dayHead);
      day.exercises.forEach((ex) => {
        if (!ex.modifiers) ex.modifiers = [];
        const row = document.createElement("div");
        row.className = "archive-ex-row";
        const rxParts = [];
        if (ex.sets) rxParts.push(ex.sets + " sets");
        if (ex.currentWeight) rxParts.push(ex.currentWeight === "BW" ? "BW" : ex.currentWeight + " lb");
        if (ex.currentReps) rxParts.push("× " + ex.currentReps);
        if (showTagChips) {
          const chips = orderedModifiers(ex).map((tag) => {
            const g = groupForTag(tag);
            if (!g) return "";
            const { color, bg } = tagColor(tag);
            return `<span class="mod-chip" style="--mc:${color};--mb:${bg}">${escapeHtml(tag)}</span>`;
          }).join("");
          row.innerHTML = `<span class="archive-ex-chips">${chips}</span><span class="archive-ex-name">${escapeHtml(ex.name || "(unnamed)")}</span><span class="archive-ex-rx">${escapeHtml(rxParts.join(" · ") || "")}</span>`;
        } else {
          row.innerHTML = `<span class="archive-ex-name">${escapeHtml(exerciseDisplayLabel(ex))}</span><span class="archive-ex-rx">${escapeHtml(rxParts.join(" · ") || "")}</span>`;
        }
        dayEl.appendChild(row);
      });
      card.appendChild(dayEl);
    });
    return card;
  }

  function renderWeekCard(week, wIdx) {
    const card = document.createElement("div");
    card.className = "week-card";
    if (week.phaseLabel) card.classList.add("phase-card");
    if (wIdx === 0) card.classList.add("open");

    const exerciseTotal = week.days.reduce((n, d) => n + d.exercises.length, 0);

    // --- Compact header ---
    const head = document.createElement("div");
    head.className = "week-head";
    head.innerHTML = `
      <div class="week-head-left">
        <span class="week-toggle-icon">▸</span>
        <div>
          <h4>${week.phaseLabel ? `<span class="phase-badge">${escapeHtml(week.phaseLabel)}</span>` : ""}${escapeHtml(week.label)}</h4>
          <div class="week-info">${week.days.length} day${week.days.length === 1 ? "" : "s"} · ${exerciseTotal} exercise${exerciseTotal === 1 ? "" : "s"}${week.focus ? " · " + escapeHtml(week.focus) : ""}</div>
        </div>
      </div>
      <div class="week-head-right">
        <button class="btn-icon-mini" data-action="delete-week" title="Delete week">✕</button>
      </div>`;

    head.addEventListener("click", (e) => {
      if (e.target.closest("[data-action]")) return;
      card.classList.toggle("open");
    });
    head.querySelector('[data-action="delete-week"]').addEventListener("click", (e) => {
      e.stopPropagation();
      if (!window.confirm(`Delete ${week.label}?`)) return;
      if (_programEditorId) {
        const tpl = currentProgramTemplate(); if (!tpl) return;
        tpl.weeks = tpl.weeks.filter((w) => w.id !== week.id);
        tpl.weeks.forEach((w, i) => { if (/^Week \d+$/.test(w.label)) w.label = `Week ${i + 1}`; });
      } else {
        const c = currentClient(); if (!c) return;
        c.weeks = c.weeks.filter((w) => w.id !== week.id);
        c.weeks.forEach((w, i) => { if (/^Week \d+$/.test(w.label)) w.label = `Week ${i + 1}`; });
      }
      saveTrainer();
      renderWeeks(); if (!_programEditorId) { renderDiet(); renderCoachCalendar(); }
    });

    // --- Body ---
    const body = document.createElement("div");
    body.className = "week-body";

    // Track active day index (transient — resets on full renderWeeks)
    if (week._activeDayIdx === undefined || week._activeDayIdx >= week.days.length) {
      week._activeDayIdx = 0;
    }

    const tabStrip  = document.createElement("div");
    tabStrip.className = "day-tab-strip";
    const dayContent = document.createElement("div");
    dayContent.className = "day-content-area";

    function renderDayTabs() {
      tabStrip.innerHTML = "";
      const moodClient = _programEditorId ? null : currentClient();
      week.days.forEach((day, dIdx) => {
        const tab = document.createElement("button");
        tab.className = "day-tab" + (dIdx === week._activeDayIdx ? " active" : "");
        const dm = moodClient ? dayMoods(moodClient.importedProgress, day.id) : [];
        tab.innerHTML = `<span class="day-tab-name">${escapeHtml(day.name || `Day ${dIdx + 1}`)}</span>${dm.length ? moodChipsHtml(dm, true) : ""}`;
        tab.addEventListener("click", () => {
          week._activeDayIdx = dIdx;
          renderDayTabs();
          renderActiveDayContent();
        });
        tabStrip.appendChild(tab);
      });
      const addDayBtn = document.createElement("button");
      addDayBtn.className = "day-tab day-tab-add";
      addDayBtn.textContent = "+ Day";
      addDayBtn.addEventListener("click", () => {
        week.days.push(makeDay(week.days.length + 1));
        week._activeDayIdx = week.days.length - 1;
        saveTrainer(); renderDayTabs(); renderActiveDayContent();
      });
      tabStrip.appendChild(addDayBtn);
    }

    function renderActiveDayContent() {
      dayContent.innerHTML = "";
      if (!week.days.length) {
        const p = document.createElement("p");
        p.className = "muted"; p.style.padding = "1rem 0";
        p.textContent = "No training days yet. Click + Day to add one.";
        dayContent.appendChild(p);
        return;
      }
      const dayIdx = Math.min(week._activeDayIdx, week.days.length - 1);
      const rerender = () => { renderDayTabs(); renderActiveDayContent(); };
      dayContent.appendChild(renderDayContent(week, week.days[dayIdx], rerender));
    }

    renderDayTabs();
    renderActiveDayContent();

    body.appendChild(tabStrip);
    body.appendChild(dayContent);
    card.appendChild(head);
    card.appendChild(body);
    return card;
  }

  // Supersets: consecutive exercises sharing a truthy supersetId are done
  // back-to-back and render as one visual block. Rides the weeks jsonb — no
  // schema change. Non-grouped exercises are singleton groups.
  function groupSupersets(exercises) {
    const groups = [];
    (exercises || []).forEach((ex) => {
      const last = groups[groups.length - 1];
      if (ex.supersetId && last && last.id === ex.supersetId) last.items.push(ex);
      else groups.push({ id: ex.supersetId || null, items: [ex] });
    });
    return groups;
  }
  // Link an exercise with the next one, or break its existing superset.
  function toggleSuperset(day, ex) {
    const g = groupSupersets(day.exercises).find((grp) => grp.items.includes(ex));
    if (g && g.items.length > 1) {
      g.items.forEach((e) => { delete e.supersetId; });        // break the group
    } else {
      const i = day.exercises.indexOf(ex);
      const next = day.exercises[i + 1];
      if (!next) return;                                        // nothing below to link with
      const id = next.supersetId || ex.supersetId || uid();
      ex.supersetId = id; next.supersetId = id;
    }
    saveTrainer();
  }
  // Append day.exercises to `list`, wrapping superset runs in a block. `makeRow`
  // builds one exercise element; `athlete` picks the athlete-side hint text.
  function appendExerciseGroups(list, day, makeRow, athlete) {
    let letterIdx = 0;
    groupSupersets(day.exercises).forEach((g) => {
      if (g.items.length > 1) {
        const letter = String.fromCharCode(65 + (letterIdx++ % 26));
        const gEl = document.createElement("div");
        gEl.className = "superset-group";
        const head = document.createElement("div");
        head.className = "superset-head";
        head.innerHTML = `<span class="superset-badge">🔗 Superset ${letter}</span><span class="superset-hint muted">${athlete ? "do these back-to-back" : "done back-to-back"}</span>`;
        gEl.appendChild(head);
        g.items.forEach((ex) => gEl.appendChild(makeRow(ex)));
        list.appendChild(gEl);
      } else {
        list.appendChild(makeRow(g.items[0]));
      }
    });
  }

  // Collapsible coach-side mobility group (warm-up at top / finisher at bottom).
  // Open/closed state persists across rerenders, keyed by day id + slot.
  function coachMobilitySection(dayId, slot, label, items, rowRenderer) {
    const stateKey = dayId + ":" + slot;
    const details = document.createElement("details");
    details.className = "coach-mobility-section";
    details.open = _coachMobOpen.has(stateKey);
    details.addEventListener("toggle", () => {
      if (details.open) _coachMobOpen.add(stateKey); else _coachMobOpen.delete(stateKey);
    });
    const summary = document.createElement("summary");
    summary.className = "coach-mobility-summary";
    summary.textContent = `${label} (${items.length})`;
    details.appendChild(summary);
    const inner = document.createElement("div");
    inner.className = "coach-mobility-list";
    appendExerciseGroups(inner, { exercises: items }, rowRenderer, false);
    details.appendChild(inner);
    return details;
  }

  function renderDayContent(week, day, rerenderFn, opts) {
    opts = opts || {};
    const wrapper = document.createElement("div");
    wrapper.className = "day-content";

    // Action bar: name + tool buttons
    const actionBar = document.createElement("div");
    actionBar.className = "day-action-bar";

    const iconBtn = document.createElement("button");
    iconBtn.type = "button";
    iconBtn.className = "day-icon-btn";
    iconBtn.title = "Choose an icon for this day";
    setDayIcon(iconBtn, day.icon || "🐉");
    iconBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      openIconPicker(day.icon || "🐉", (icon) => {
        day.icon = icon;
        setDayIcon(iconBtn, icon);
        saveTrainer();
      }, iconBtn);
    });

    const nameWrap = document.createElement("div");
    nameWrap.className = "day-name-wrap";

    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.className = "day-name-compact";
    nameInput.placeholder = "Day name…";
    nameInput.value = day.name || "";
    nameInput.addEventListener("input", () => { day.name = nameInput.value; saveTrainer(); });
    nameInput.addEventListener("change", () => rerenderFn());
    nameInput.addEventListener("keydown", (e) => { if (e.key === "Enter") nameInput.blur(); });

    nameWrap.appendChild(nameInput);

    actionBar.appendChild(iconBtn);

    const spacer = document.createElement("div");
    spacer.style.flex = "1";

    // Library button: only shown on mobile (sidebar is hidden there); on desktop the sidebar is always visible
    const libBtn = document.createElement("button");
    libBtn.className = "btn btn-ghost btn-xs ex-lib-mobile-btn";
    libBtn.title = "Exercise library";
    libBtn.textContent = "📖 Library";
    libBtn.addEventListener("click", () => openExLibrary(day, rerenderFn));

    const delDayBtn = document.createElement("button");
    delDayBtn.className = "btn btn-ghost btn-xs";
    delDayBtn.style.color = "var(--danger)";
    delDayBtn.title = "Delete this day";
    delDayBtn.textContent = "✕ Day";
    delDayBtn.addEventListener("click", () => {
      if (!window.confirm(`Delete "${day.name || "this day"}"?`)) return;
      week.days = week.days.filter((d) => d.id !== day.id);
      if (week._activeDayIdx >= week.days.length) week._activeDayIdx = Math.max(0, week.days.length - 1);
      saveTrainer(); rerenderFn();
    });

    actionBar.appendChild(nameWrap);
    actionBar.appendChild(spacer);
    actionBar.appendChild(libBtn);
    if (!opts.hideDelete) actionBar.appendChild(delDayBtn);

    // Table header
    const tableHead = document.createElement("div");
    tableHead.className = "ex-table-head";
    tableHead.innerHTML = `
      <span class="ex-th-handle"></span>
      <span class="ex-th-name">Exercise</span>
      <span class="ex-th-sets">Sets</span>
      <span class="ex-th-cur">Current</span>
      <span class="ex-th-goal">Goal</span>
      <span class="ex-th-act"></span>`;

    // Exercise list (drop zone)
    const list = document.createElement("div");
    list.className = "ex-compact-list";

    // Mobility/stretching sits in its own collapsible section (click to open):
    // warm-up holds pin to the top of the day, finisher holds to the bottom.
    const rowRenderer = (ex) => renderExerciseRow(day, ex, rerenderFn);
    // Hold-for-time items (kind:"mobility") split by flavour: speed/agility drills
    // get their own ⚡ section, stretches keep the 🧘 one. Manually-toggled holds
    // (no library category) fall through to the stretch section as before.
    const isSpeedEx = (e) => e.kind === "mobility" && isSpeedName(e.name);
    const isStretchEx = (e) => e.kind === "mobility" && !isSpeedName(e.name);
    const speedTop = day.exercises.filter((e) => isSpeedEx(e) && e.mobPlacement !== "bottom");
    const speedBottom = day.exercises.filter((e) => isSpeedEx(e) && e.mobPlacement === "bottom");
    const mobTop = day.exercises.filter((e) => isStretchEx(e) && e.mobPlacement !== "bottom");
    const mobBottom = day.exercises.filter((e) => isStretchEx(e) && e.mobPlacement === "bottom");
    const mainEx = day.exercises.filter((e) => e.kind !== "mobility");
    if (speedTop.length) list.appendChild(coachMobilitySection(day.id, "speed-top", "⚡ Speed & Agility", speedTop, rowRenderer));
    if (mobTop.length) list.appendChild(coachMobilitySection(day.id, "top", "🧘 Mobility & Stretching", mobTop, rowRenderer));
    appendExerciseGroups(list, { exercises: mainEx }, rowRenderer, false);
    if (mobBottom.length) list.appendChild(coachMobilitySection(day.id, "bottom", "🧘 Finisher Stretches", mobBottom, rowRenderer));
    if (speedBottom.length) list.appendChild(coachMobilitySection(day.id, "speed-bottom", "⚡ Speed & Agility Finisher", speedBottom, rowRenderer));

    // Always show a drop zone — big when empty, slim hint when exercises exist
    const dropHint = document.createElement("div");
    dropHint.className = day.exercises.length === 0 ? "ex-list-empty-drop" : "ex-list-drop-hint";
    dropHint.textContent = day.exercises.length === 0 ? "Drag exercises from the library →" : "drag to add more";
    dropHint.setAttribute("aria-hidden", "true");
    list.appendChild(dropHint);

    // Type-to-add — autocompletes from the library but also accepts any custom
    // name. Complements drag-and-drop and is the fast path on touch devices.
    const quickAdd = document.createElement("form");
    quickAdd.className = "ex-quick-add";
    const quickInput = document.createElement("input");
    quickInput.type = "text";
    quickInput.className = "ex-quick-add-input";
    quickInput.placeholder = "Type an exercise to add…";
    quickInput.setAttribute("list", ensureExerciseDatalist());
    quickInput.setAttribute("autocomplete", "off");
    const quickBtn = document.createElement("button");
    quickBtn.type = "submit";
    quickBtn.className = "btn btn-primary btn-sm ex-quick-add-btn";
    quickBtn.textContent = "Add";
    quickAdd.appendChild(quickInput);
    quickAdd.appendChild(quickBtn);
    quickAdd.addEventListener("submit", (e) => {
      e.preventDefault();
      const name = quickInput.value.trim();
      if (!name) return;
      day.exercises.push(makeExercise({ name }));
      _focusQuickAddDayId = day.id; // keep focus so several can be added in a row
      saveTrainer(); rerenderFn();
    });
    list.appendChild(quickAdd);
    if (_focusQuickAddDayId === day.id) {
      _focusQuickAddDayId = null;
      setTimeout(() => quickInput.focus(), 0);
    }

    list.addEventListener("dragover", (e) => {
      if (!e.dataTransfer.types.includes("text/ex-name")) return;
      e.preventDefault(); list.classList.add("drag-over");
    });
    list.addEventListener("dragleave", (e) => {
      if (!list.contains(e.relatedTarget)) list.classList.remove("drag-over");
    });
    list.addEventListener("drop", (e) => {
      e.preventDefault(); list.classList.remove("drag-over");
      const name = e.dataTransfer.getData("text/ex-name");
      if (!name) return;
      day.exercises.push(makeExercise({ name }));
      saveTrainer(); rerenderFn();
    });

    wrapper.appendChild(actionBar);
    wrapper.appendChild(tableHead);
    wrapper.appendChild(list);
    return wrapper;
  }

  function renderExerciseRow(day, ex, rerenderFn) {
    const wrapper = document.createElement("div");
    wrapper.className = "ex-row-wrapper";
    wrapper.dataset.exid = ex.id;

    const row = document.createElement("div");
    row.className = "ex-row";

    if (!ex.modifiers) ex.modifiers = []; // backfill old data
    const isMob = ex.kind === "mobility"; // rounds × hold-seconds, no weights
    const isTimed = exIsTimed(ex);        // carries: weight × time (seconds)

    // Drag handle (desktop — hidden on mobile where native HTML5 drag doesn't work)
    const handle = document.createElement("span");
    handle.className = "ex-drag-handle";
    handle.textContent = "⠿";
    handle.title = "Drag to reorder";

    // Move up/down buttons (mobile — touch-friendly stand-in for drag-to-reorder)
    function moveExercise(dir) {
      const idx = day.exercises.findIndex((e) => e.id === ex.id);
      const swapIdx = idx + dir;
      if (idx === -1 || swapIdx < 0 || swapIdx >= day.exercises.length) return;
      [day.exercises[idx], day.exercises[swapIdx]] = [day.exercises[swapIdx], day.exercises[idx]];
      saveTrainer(); rerenderFn();
    }
    const moveUpBtn = document.createElement("button");
    moveUpBtn.className = "btn-icon-mini ex-move-btn";
    moveUpBtn.title = "Move up"; moveUpBtn.textContent = "▲";
    moveUpBtn.addEventListener("click", () => moveExercise(-1));

    const moveDownBtn = document.createElement("button");
    moveDownBtn.className = "btn-icon-mini ex-move-btn";
    moveDownBtn.title = "Move down"; moveDownBtn.textContent = "▼";
    moveDownBtn.addEventListener("click", () => moveExercise(1));

    // Jump straight to the top/bottom of the day — the fast way to organize
    // long days without tapping ▲/▼ a dozen times.
    function moveExerciseEdge(toTop) {
      const idx = day.exercises.findIndex((e) => e.id === ex.id);
      if (idx === -1) return;
      day.exercises.splice(idx, 1);
      if (toTop) day.exercises.unshift(ex); else day.exercises.push(ex);
      saveTrainer(); rerenderFn();
    }
    const moveTopBtn = document.createElement("button");
    moveTopBtn.className = "btn-icon-mini ex-move-btn ex-move-edge-btn";
    moveTopBtn.title = "Move to top"; moveTopBtn.textContent = "⤒";
    moveTopBtn.addEventListener("click", () => moveExerciseEdge(true));

    const moveBottomBtn = document.createElement("button");
    moveBottomBtn.className = "btn-icon-mini ex-move-btn ex-move-edge-btn";
    moveBottomBtn.title = "Move to bottom"; moveBottomBtn.textContent = "⤓";
    moveBottomBtn.addEventListener("click", () => moveExerciseEdge(false));

    // Opens the tag picker; chips clicked below route here so tags can only be
    // removed by unclicking them inside the popup (never by tapping the chip).
    // refreshCwLabel keeps the weight label's singular/plural (DB pair) form
    // in sync as tags toggle — defined further down, resolved at click time.
    const openPicker = () => openModPicker(ex, modBtn, chipsBefore, chipsAfter, () => { refreshCwLabel(); refreshWarmupBtn(); });

    // Modifier chips BEFORE name (Unilateral, Equipment, Position)
    const chipsBefore = document.createElement("div");
    chipsBefore.className = "mod-chips-before";
    renderModChips(chipsBefore, ex, "before", openPicker);

    // Name
    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.className = "ex-name-compact";
    nameInput.placeholder = "Exercise name…";
    nameInput.value = ex.name || "";
    nameInput.addEventListener("input", () => { ex.name = nameInput.value; saveTrainer(); });
    nameInput.addEventListener("change", () => { demoRow._repaintDemo?.(); });

    // Modifier chips AFTER name (Style)
    const chipsAfter = document.createElement("div");
    chipsAfter.className = "mod-chips-after";
    renderModChips(chipsAfter, ex, "after", openPicker);

    // Modifier picker button
    const modBtn = document.createElement("button");
    modBtn.className = "mod-add-btn";
    modBtn.title = "Add/remove modifiers (1A, DB, Pause…)";
    modBtn.textContent = "tag";
    modBtn.addEventListener("click", (e) => { e.stopPropagation(); openPicker(); });


    // Sets
    const setsBtn = document.createElement("button");
    setsBtn.className = "picker-btn picker-btn-sm" + (ex.sets ? "" : " empty");
    setsBtn.textContent = ex.sets || "—";
    setsBtn.title = isMob ? "Rounds" : "Sets";
    setsBtn.addEventListener("click", (e) => { e.stopPropagation(); openGridPicker(isMob ? "Rounds" : "Sets", SETS_VALUES, ex.sets || "3", (val) => {
      ex.sets = val; saveTrainer(); setsBtn.textContent = val; setsBtn.classList.remove("empty");
    }, setsBtn); });

    // Mobility hold-duration button (seconds). Edits ex.currentReps (reused as the
    // hold length) and displays like "30s". Only used when isMob.
    const holdBtn = document.createElement("button");
    holdBtn.className = "picker-btn picker-btn-sm" + (ex.currentReps ? "" : " empty");
    holdBtn.textContent = ex.currentReps ? ex.currentReps + "s" : "Hold";
    holdBtn.title = "Hold (seconds)";
    holdBtn.addEventListener("click", (e) => { e.stopPropagation(); openGridPicker("Hold (sec)", HOLD_SEC_VALUES, ex.currentReps || "30", (val) => {
      ex.currentReps = val; saveTrainer(); holdBtn.textContent = val + "s"; holdBtn.classList.remove("empty");
    }, holdBtn, 4); });

    // Mobility placement toggle: warm-up (top) vs finisher (bottom). Only used
    // when isMob. mobPlacement defaults to "top" when unset.
    const placeBtn = document.createElement("button");
    placeBtn.className = "picker-btn picker-btn-sm ex-place-btn";
    const isBottom = ex.mobPlacement === "bottom";
    placeBtn.textContent = isBottom ? "⬆ Warm-up" : "⬇ Finisher";
    placeBtn.title = isBottom ? "Move to warm-up (top)" : "Move to finisher (bottom)";
    placeBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      ex.mobPlacement = isBottom ? "top" : "bottom";
      saveTrainer(); rerenderFn();
    });

    const at = document.createElement("span");
    at.className = "ex-row-sep"; at.textContent = "@";

    // Prescribed weight (single — the old upper/range weight was retired
    // 2026-07-15 when auto-progression replaced weight ranges; goalWeight
    // stays in the data model but has no UI, like goalReps)
    const cwBtn = document.createElement("button");
    cwBtn.className = "picker-btn picker-btn-sm" + (ex.currentWeight ? "" : " empty");
    const refreshCwLabel = () => { cwBtn.textContent = exWeightLabel(ex, ex.currentWeight) || "Wt"; };
    refreshCwLabel();
    cwBtn.title = "Prescribed weight";
    cwBtn.addEventListener("click", (e) => { e.stopPropagation(); openWeightPicker(ex.currentWeight || "BW", (val) => {
      ex.currentWeight = val; saveTrainer(); refreshCwLabel(); cwBtn.classList.toggle("empty", !val);
      refreshProgBtn(); // BW ↔ weighted flips the progression rule type
    }, cwBtn); });

    const x1 = document.createElement("span");
    x1.className = "ex-row-sep"; x1.textContent = "×";

    // Prescribed reps (carries: prescribed seconds, shown as "40s")
    const crLabel = (v) => (isTimed && /^\d+(\.\d+)?$/.test(String(v)) ? v + "s" : v);
    const crBtn = document.createElement("button");
    crBtn.className = "picker-btn picker-btn-sm" + (ex.currentReps ? "" : " empty");
    crBtn.textContent = crLabel(ex.currentReps) || "—";
    crBtn.title = isTimed ? "Prescribed time (seconds)" : "Prescribed reps";
    crBtn.addEventListener("click", (e) => { e.stopPropagation(); openGridPicker(
      isTimed ? "Time (sec)" : "Reps",
      isTimed ? CARRY_SEC_VALUES : REPS_VALUES,
      ex.currentReps || (isTimed ? "30" : "8"), (val) => {
      ex.currentReps = val; saveTrainer(); crBtn.textContent = crLabel(val); crBtn.classList.toggle("empty", !val);
      refreshProgBtn(); // reps are the ladder's floor
    }, crBtn, isTimed ? 4 : 6); });

    // Warm-up sets (optional, up to 2) — explicit lb × reps, done before the
    // working sets. Mirrors the finisher button; sits at the front of the cluster.
    const warmupBtn = document.createElement("button");
    warmupBtn.className = "picker-btn picker-btn-sm ex-warmup-btn";
    warmupBtn.title = "Warm-up sets (before working sets)";
    const refreshWarmupBtn = () => {
      const sum = warmupSummary(ex);
      warmupBtn.textContent = sum || "＋ Warm";
      warmupBtn.classList.toggle("empty", !sum);
    };
    refreshWarmupBtn();
    warmupBtn.addEventListener("click", (e) => { e.stopPropagation(); openWarmupPicker(ex, warmupBtn, refreshWarmupBtn); });

    // Finisher (burnout / dropset) — sits at the end of the sets cluster.
    const finisherBtn = document.createElement("button");
    finisherBtn.className = "picker-btn picker-btn-sm ex-finisher-btn";
    finisherBtn.title = "Burnout / Dropset finisher";
    const refreshFinisherBtn = () => {
      const sum = finisherSummary(ex);
      finisherBtn.textContent = sum || "＋💥";
      finisherBtn.classList.toggle("empty", !sum);
    };
    refreshFinisherBtn();
    finisherBtn.addEventListener("click", (e) => { e.stopPropagation(); openFinisherPicker(ex, finisherBtn, refreshFinisherBtn); });

    // Pyramid — weight climbs each set by a percent; sandy card when on.
    const pyrBtn = document.createElement("button");
    pyrBtn.className = "picker-btn picker-btn-sm ex-pyr-btn";
    pyrBtn.title = "Pyramid: weight climbs each set by a percent (rounded to 5 lb plates)";
    const refreshPyrBtn = () => {
      const on = pyramidActive(ex);
      pyrBtn.textContent = on ? `🔺+${ex.pyramid.pct}%` : "＋🔺";
      pyrBtn.classList.toggle("empty", !on);
      wrapper.classList.toggle("pyramid-tint", on);
    };
    refreshPyrBtn();
    pyrBtn.addEventListener("click", (e) => { e.stopPropagation(); openPyramidPicker(ex, pyrBtn, refreshPyrBtn); });

    // Effort / intensity (heat ramp) — sits with the finisher.
    const effortBtn = document.createElement("button");
    effortBtn.className = "picker-btn picker-btn-sm ex-effort-btn";
    effortBtn.title = "Effort / intensity";
    const refreshEffortBtn = () => {
      const m = effortLevel(ex);
      effortBtn.textContent = m ? m.flames : "＋🔥";
      effortBtn.classList.toggle("empty", !m);
      if (m) effortBtn.style.setProperty("--effort-rgb", m.rgb);
      else effortBtn.style.removeProperty("--effort-rgb");
      applyEffortWrapper(wrapper, ex);
    };
    refreshEffortBtn();
    effortBtn.addEventListener("click", (e) => { e.stopPropagation(); openEffortPicker(ex, effortBtn, refreshEffortBtn); });

    // Auto-progression (double progression) — reps climb to a ceiling, then
    // the athlete's next-week target adds weight. Computed display, see
    // effectiveProgression(); doesn't apply to holds or BW lifts.
    const progBtn = document.createElement("button");
    progBtn.className = "picker-btn picker-btn-sm ex-prog-btn";
    progBtn.title = "Auto-progression: when every set hits the rep ceiling, next week's target adds weight";
    const refreshProgBtn = () => {
      const r = progressionRule(ex);
      progBtn.textContent = !r ? "＋📈"
        : r.bw ? `📈${r.floor}→${r.ceil === PROG_NO_CAP ? "∞" : r.ceil}${r.graduate ? ` +${r.inc}` : ""}`
        : r.repsOnly ? `📈${r.floor}→${r.ceil} reps`
        : `📈${r.floor}–${r.ceil} +${r.inc}${r.reset !== r.floor ? "→" + r.reset : ""}`;
      progBtn.classList.toggle("empty", !r);
    };
    refreshProgBtn();
    progBtn.addEventListener("click", (e) => { e.stopPropagation(); openProgressionPicker(ex, progBtn, refreshProgBtn); });

    // Expand (notes + video)
    const expandBtn = document.createElement("button");
    expandBtn.className = "btn-icon-mini ex-expand-btn";
    expandBtn.title = "Notes & video"; expandBtn.textContent = "⋮";

    // Save / Edit lock buttons
    const saveBtn = document.createElement("button");
    saveBtn.className = "btn-icon-mini ex-save-btn";
    saveBtn.title = "Lock exercise";
    saveBtn.textContent = "✓";

    const editBtn = document.createElement("button");
    editBtn.className = "btn-icon-mini ex-edit-btn";
    editBtn.title = "Edit exercise";
    editBtn.textContent = "✎";

    function applyLock(locked) {
      wrapper.classList.toggle("ex-locked", locked);
      nameInput.disabled = locked;
      modBtn.disabled = locked;
      setsBtn.disabled = locked;
      cwBtn.disabled = locked;
      crBtn.disabled = locked;
      warmupBtn.disabled = locked;
      finisherBtn.disabled = locked;
      effortBtn.disabled = locked;
      progBtn.disabled = locked;
      pyrBtn.disabled = locked;
      handle.style.opacity = locked ? "0.3" : "";
      handle.style.pointerEvents = locked ? "none" : "";
      moveUpBtn.disabled = locked;
      moveDownBtn.disabled = locked;
      moveTopBtn.disabled = locked;
      moveBottomBtn.disabled = locked;
      chipsBefore.style.pointerEvents = locked ? "none" : "";
      chipsAfter.style.pointerEvents = locked ? "none" : "";
      saveBtn.classList.toggle("hidden", locked);
      editBtn.classList.toggle("hidden", !locked);
    }

    saveBtn.addEventListener("click", () => { ex.locked = true;  saveTrainer(); applyLock(true); });
    editBtn.addEventListener("click", () => { ex.locked = false; saveTrainer(); applyLock(false); });
    applyLock(!!ex.locked);

    // Superset link — pair this exercise with the one below (or break the group)
    const ssBtn = document.createElement("button");
    ssBtn.className = "btn-icon-mini ex-ss-btn";
    ssBtn.textContent = "🔗";
    (function refreshSs() {
      const g = groupSupersets(day.exercises).find((grp) => grp.items.includes(ex));
      const inSS = !!(g && g.items.length > 1);
      const isLast = day.exercises.indexOf(ex) === day.exercises.length - 1;
      ssBtn.classList.toggle("active", inSS);
      ssBtn.title = inSS ? "Break superset" : "Superset with exercise below";
      ssBtn.classList.toggle("hidden", !inSS && isLast); // nothing below to link with
    })();
    ssBtn.addEventListener("click", () => { toggleSuperset(day, ex); rerenderFn(); });

    // Delete
    const delBtn = document.createElement("button");
    delBtn.className = "btn-icon-mini ex-del-btn";
    delBtn.title = "Delete exercise"; delBtn.textContent = "✕";
    delBtn.addEventListener("click", () => {
      day.exercises = day.exercises.filter((e) => e.id !== ex.id);
      saveTrainer(); rerenderFn();
    });

    // Sets/weight/reps picker cluster — grouped so it wraps as one unit on
    // mobile instead of splitting a separator (@, –, ×) from its button.
    // Only the core sets/weight/reps cluster stays glued together (so a
    // separator never splits from its button). Warm-up and finisher are
    // independent row items that can wrap on their own on mobile.
    const metricsGroup = document.createElement("div");
    metricsGroup.className = "ex-metrics-group";
    if (isMob) {
      // Rounds × Hold(s) — no weights.
      metricsGroup.appendChild(setsBtn); metricsGroup.appendChild(x1); metricsGroup.appendChild(holdBtn);
    } else {
      metricsGroup.appendChild(setsBtn); metricsGroup.appendChild(at);
      metricsGroup.appendChild(cwBtn);
      metricsGroup.appendChild(x1); metricsGroup.appendChild(crBtn);
    }

    // All four reorder arrows travel together: hidden entirely on desktop
    // (drag-and-drop covers it there) and stacked into a rail on touch, where
    // HTML5 drag doesn't fire. Appended at the end of the row so the rail sits
    // on the right — see .ex-move-group in styles.css.
    const moveGroup = document.createElement("div");
    moveGroup.className = "ex-move-group";
    moveGroup.append(moveTopBtn, moveUpBtn, moveDownBtn, moveBottomBtn);

    row.appendChild(handle);
    // Effort/heat stays pinned on the left; tag chips render after it so adding
    // tags never shifts the effort button around. Intensity doesn't apply to
    // mobility/stretching holds.
    if (!isMob) row.appendChild(effortBtn);
    row.appendChild(chipsBefore);
    row.appendChild(nameInput);
    row.appendChild(chipsAfter);
    row.appendChild(modBtn);
    if (!isMob) row.appendChild(warmupBtn); // warm-up/finisher don't apply to holds
    row.appendChild(metricsGroup);
    if (!isMob) row.appendChild(progBtn); // auto-progression rides the working sets
    if (!isMob) row.appendChild(pyrBtn);  // pyramid weight ladder
    if (!isMob) row.appendChild(finisherBtn);
    if (isMob) row.appendChild(placeBtn); // warm-up ↔ finisher placement
    row.appendChild(expandBtn); row.appendChild(saveBtn); row.appendChild(editBtn); row.appendChild(ssBtn); row.appendChild(delBtn);
    row.appendChild(moveGroup);

    // Detail panel (notes + video), hidden by default
    const detail = document.createElement("div");
    detail.className = "ex-detail-panel hidden";

    const notesTA = document.createElement("textarea");
    notesTA.className = "ex-notes-compact";
    notesTA.placeholder = "Notes, tempo, cues, progression…";
    notesTA.rows = 2;
    notesTA.value = ex.notes || "";
    notesTA.addEventListener("input", () => { ex.notes = notesTA.value; saveTrainer(); });

    const videoInput = document.createElement("input");
    videoInput.type = "text";
    videoInput.className = "ex-video-compact";
    videoInput.placeholder = "YouTube link (optional)…";
    videoInput.value = ex.videoUrl || "";
    videoInput.addEventListener("input", () => { ex.videoUrl = videoInput.value; saveTrainer(); });

    // Manual fallback: flip any exercise into hold-for-time mode (rounds × hold
    // seconds), independent of whether it came from the mobility library.
    const kindToggle = document.createElement("label");
    kindToggle.className = "ex-kind-toggle";
    const kindCb = document.createElement("input");
    kindCb.type = "checkbox";
    kindCb.checked = isMob;
    kindCb.addEventListener("change", () => {
      if (kindCb.checked) {
        ex.kind = "mobility";
        if (!ex.currentReps) ex.currentReps = "30"; // default hold
        ex.currentWeight = ""; ex.goalWeight = "";  // weights don't apply
      } else {
        ex.kind = "strength";
      }
      saveTrainer();
      rerenderFn();
    });
    kindToggle.appendChild(kindCb);
    kindToggle.appendChild(document.createTextNode(" Hold for time (stretch / drill)"));

    const demoRow = buildCoachDemoRow(ex);

    detail.appendChild(notesTA);
    detail.appendChild(videoInput);
    detail.appendChild(demoRow);
    detail.appendChild(kindToggle);

    if (ex.notes || ex.videoUrl) {
      detail.classList.remove("hidden");
      expandBtn.classList.add("active");
    }

    expandBtn.addEventListener("click", () => {
      const nowHidden = detail.classList.toggle("hidden");
      expandBtn.classList.toggle("active", !nowHidden);
      if (!nowHidden) notesTA.focus();
    });

    // Drag to reorder within day
    handle.addEventListener("mousedown", () => wrapper.setAttribute("draggable", "true"));
    handle.addEventListener("touchstart", () => wrapper.setAttribute("draggable", "true"), { passive: true });
    wrapper.addEventListener("dragend", () => {
      wrapper.removeAttribute("draggable");
      wrapper.classList.remove("dragging", "drag-above", "drag-below");
      // The gap lives on whichever row was hovered, not on the dragged one, so
      // an abandoned drag (dropped outside the list, Esc) would leave it open.
      wrapper.parentNode?.querySelectorAll(".drag-above, .drag-below")
        .forEach((el) => el.classList.remove("drag-above", "drag-below"));
    });
    wrapper.addEventListener("dragstart", (e) => {
      if (!wrapper.getAttribute("draggable")) { e.preventDefault(); return; }
      wrapper.classList.add("dragging");
      e.dataTransfer.setData("text/ex-reorder", JSON.stringify({ exId: ex.id, dayId: day.id }));
      e.dataTransfer.effectAllowed = "move";
    });
    wrapper.addEventListener("dragover", (e) => {
      if (!e.dataTransfer.types.includes("text/ex-reorder")) return;
      e.preventDefault();
      // Measure the ROW, not the wrapper. The gap is padding on the wrapper, so
      // testing against the wrapper's own box would move the midpoint the gap
      // just created and flip the choice back under a stationary cursor. The
      // row only moves for drag-above (padding-top pushes it down), which keeps
      // each state self-consistent and adds a little hysteresis between them.
      const rect = row.getBoundingClientRect();
      const above = e.clientY < rect.top + rect.height / 2;
      wrapper.classList.toggle("drag-above", above);
      wrapper.classList.toggle("drag-below", !above);
    });
    wrapper.addEventListener("dragleave", () => wrapper.classList.remove("drag-above", "drag-below"));
    wrapper.addEventListener("drop", (e) => {
      e.preventDefault();
      // Go by the class the gap is showing, not a fresh measurement — the card
      // must land exactly where the placeholder slot said it would.
      const insertAfter = wrapper.classList.contains("drag-below");
      wrapper.classList.remove("drag-above", "drag-below");
      try {
        const { exId, dayId } = JSON.parse(e.dataTransfer.getData("text/ex-reorder"));
        if (dayId !== day.id || exId === ex.id) return;
        const fromIdx = day.exercises.findIndex((e) => e.id === exId);
        const toIdx   = day.exercises.findIndex((e) => e.id === ex.id);
        if (fromIdx === -1 || toIdx === -1) return;
        const [moved] = day.exercises.splice(fromIdx, 1);
        const newTo = day.exercises.findIndex((e) => e.id === ex.id);
        day.exercises.splice(insertAfter ? newTo + 1 : newTo, 0, moved);
        saveTrainer(); rerenderFn();
      } catch { /* ignore bad data */ }
    });

    wrapper.appendChild(row);
    wrapper.appendChild(detail);
    return wrapper;
  }
  function addWeek() {
    if (_programEditorId) {
      const tpl = currentProgramTemplate(); if (!tpl) return;
      if (tpl.weeks.length >= 12) { toast("12-week maximum reached"); return; }
      _coachActiveWeekIdx = tpl.weeks.length;
      tpl.weeks.push(makeWeek(tpl.weeks.length));
      saveTrainer(); renderWeeks();
      return;
    }
    const c = currentClient(); if (!c) return;
    if (c.weeks.length >= 12) { toast("12-week maximum reached"); return; }
    _coachActiveWeekIdx = c.weeks.length;
    c.weeks.push(makeWeek(c.weeks.length));
    saveTrainer();
    renderWeeks(); renderDiet(); renderCoachCalendar();
  }

  // -------- Nutrition plan (standing per-athlete targets + history) --------
  // Macro slice colors are CVD-validated against the app surface (dataviz
  // six-checks) — don't swap them for the raw theme tokens.
  const MACROS = [
    { key: "protein", label: "Protein", kcalPerG: 4, color: "#0ea5c4" },
    { key: "carbs",   label: "Carbs",   kcalPerG: 4, color: "#d97706" },
    { key: "fat",     label: "Fat",     kcalPerG: 9, color: "#8b5cf6" },
  ];

  function ensureNutrition(c) {
    if (!c) return;
    if (!c.nutrition || typeof c.nutrition !== "object") c.nutrition = { current: null, history: [] };
    if (!Array.isArray(c.nutrition.history)) c.nutrition.history = [];
  }

  function macroBreakdown(plan) {
    const parts = MACROS
      .map((m) => ({ ...m, grams: Math.max(0, Number(plan?.[m.key]) || 0) }))
      .map((p) => ({ ...p, kcal: p.grams * p.kcalPerG }))
      .filter((p) => p.grams > 0);
    const totalKcal = parts.reduce((n, p) => n + p.kcal, 0);
    return {
      totalKcal,
      parts: parts.map((p) => ({ ...p, pct: totalKcal ? Math.round((p.kcal * 100) / totalKcal) : 0 })),
    };
  }

  function donutArcPath(cx, cy, rO, rI, a0, a1) {
    const pt = (r, a) => `${(cx + r * Math.cos(a)).toFixed(2)} ${(cy + r * Math.sin(a)).toFixed(2)}`;
    const large = a1 - a0 > Math.PI ? 1 : 0;
    return `M ${pt(rO, a0)} A ${rO} ${rO} 0 ${large} 1 ${pt(rO, a1)} L ${pt(rI, a1)} A ${rI} ${rI} 0 ${large} 0 ${pt(rI, a0)} Z`;
  }

  // Donut of the macro calorie split; center carries the daily calorie target.
  // Needs >= 2 macros to be a meaningful split — callers fall back to stat
  // tiles otherwise.
  function macroDonutHtml(plan) {
    const { parts, totalKcal } = macroBreakdown(plan);
    if (parts.length < 2) return "";
    const calTarget = Number(plan?.calories) || 0;
    const cx = 100, cy = 100, rO = 88, rI = 58;
    const gap = 0.045; // ≈2px surface gap between slices at the outer radius
    let a = -Math.PI / 2;
    let paths = "";
    parts.forEach((p) => {
      const sweep = (p.kcal / totalKcal) * Math.PI * 2;
      const a0 = a + gap / 2, a1 = a + sweep - gap / 2;
      if (a1 > a0) {
        paths += `<path d="${donutArcPath(cx, cy, rO, rI, a0, a1)}" fill="${p.color}"><title>${p.label}: ${p.grams} g · ${p.kcal.toLocaleString()} kcal · ${p.pct}%</title></path>`;
      }
      a += sweep;
    });
    const legend = parts.map((p) => `
      <div class="macro-legend-row">
        <span class="macro-dot" style="background:${p.color}"></span>
        <span class="macro-name">${p.label}</span>
        <span class="macro-detail">${p.grams} g · ${p.kcal.toLocaleString()} kcal · ${p.pct}%</span>
      </div>`).join("");
    const mismatch = calTarget && Math.abs(totalKcal - calTarget) > 50
      ? `<p class="muted macro-mismatch">Macros add up to ${totalKcal.toLocaleString()} kcal. The calorie target says ${calTarget.toLocaleString()}.</p>`
      : "";
    return `
      <div class="macro-chart">
        <svg viewBox="0 0 200 200" class="macro-donut" role="img" aria-label="Daily macro split">
          ${paths}
          <text x="100" y="96" text-anchor="middle" class="macro-center-num">${(calTarget || totalKcal).toLocaleString()}</text>
          <text x="100" y="115" text-anchor="middle" class="macro-center-lbl">kcal / day</text>
        </svg>
        <div class="macro-legend">${legend}</div>
      </div>${mismatch}`;
  }

  function nutritionPlanSummary(p) {
    const bits = [];
    if (Number(p?.calories) > 0) bits.push(`${Number(p.calories).toLocaleString()} kcal`);
    MACROS.forEach((m) => { if (Number(p?.[m.key]) > 0) bits.push(`${m.label[0]} ${p[m.key]}g`); });
    return bits.join(" · ") || "—";
  }

  // Percentages a coach entered, or (for legacy gram-only plans) derived from
  // grams + calories so the fields aren't blank when re-editing.
  function planPercents(plan) {
    if (plan?.proteinPct != null || plan?.carbsPct != null || plan?.fatPct != null) {
      return { protein: plan.proteinPct ?? "", carbs: plan.carbsPct ?? "", fat: plan.fatPct ?? "" };
    }
    const cal = Number(plan?.calories) || 0;
    const pct = (g, kcalPerG) => (cal > 0 && Number(g) > 0) ? Math.round(Number(g) * kcalPerG / cal * 100) : "";
    return { protein: pct(plan?.protein, 4), carbs: pct(plan?.carbs, 4), fat: pct(plan?.fat, 9) };
  }
  // Grams implied by calories × each macro percentage — stored on the plan so
  // the donut and athlete view (which read grams) need no changes.
  function pctToGrams(caloriesStr, pcts) {
    const cal = Number(caloriesStr) || 0;
    const g = {};
    MACROS.forEach((m) => {
      const pct = Number(pcts[m.key]) || 0;
      g[m.key] = (cal > 0 && pct > 0) ? Math.round(cal * pct / 100 / m.kcalPerG) : "";
    });
    return g;
  }
  // The "does it add up" calculator: pct → kcal → grams per macro, with a
  // total row that flags when the split isn't 100%.
  function macroCalcHtml(caloriesStr, pcts) {
    const cal = Number(caloriesStr) || 0;
    let sumPct = 0;
    const rows = MACROS.map((m) => {
      const pct = Number(pcts[m.key]) || 0;
      sumPct += pct;
      const kcal = Math.round(cal * pct / 100);
      const grams = pct > 0 ? Math.round(kcal / m.kcalPerG) : 0;
      return `<div class="macro-calc-row">
        <span class="macro-dot" style="background:${m.color}"></span>
        <span class="macro-calc-name">${m.label}</span>
        <span class="macro-calc-pct">${pct}%</span>
        <span class="macro-calc-kcal">${kcal.toLocaleString()} kcal</span>
        <span class="macro-calc-g">${grams} g</span>
      </div>`;
    }).join("");
    const diff = sumPct - 100;
    const status = sumPct === 100
      ? `<span class="macro-calc-ok">✓ adds up</span>`
      : `<span class="macro-calc-warn">${diff > 0 ? `${diff}% over` : `${-diff}% left`}</span>`;
    return `<div class="macro-calc">
      ${rows}
      <div class="macro-calc-row macro-calc-total">
        <span class="macro-dot" style="background:transparent"></span>
        <span class="macro-calc-name">Total</span>
        <span class="macro-calc-pct">${sumPct}%</span>
        <span class="macro-calc-kcal">${cal.toLocaleString()} kcal</span>
        ${status}
      </div>
    </div>`;
  }

  function renderDiet() {
    const c = currentClient(); if (!c) return;
    ensureNutrition(c);
    const container = $("#diet-container");
    container.innerHTML = "";
    const cur = c.nutrition.current || {};

    const initPct = planPercents(cur);
    const card = document.createElement("div");
    card.className = "card";
    card.innerHTML = `
      <h4 style="margin-top:0">Current plan${cur.effectiveFrom ? ` <span class="muted" style="font-weight:400;font-size:0.8rem">· since ${escapeHtml(cur.effectiveFrom)}</span>` : ""}</h4>
      <label>Calories / day
        <input type="number" min="0" id="nut-cal" placeholder="e.g. 2500" value="${escapeHtml(String(cur.calories ?? ""))}" />
      </label>
      <div class="nutrition-form" style="margin-top:0.7em">
        <label>Protein %
          <input type="number" min="0" max="100" id="nut-protein-pct" placeholder="e.g. 30" value="${escapeHtml(String(initPct.protein ?? ""))}" />
        </label>
        <label>Carbs %
          <input type="number" min="0" max="100" id="nut-carbs-pct" placeholder="e.g. 40" value="${escapeHtml(String(initPct.carbs ?? ""))}" />
        </label>
        <label>Fat %
          <input type="number" min="0" max="100" id="nut-fat-pct" placeholder="e.g. 30" value="${escapeHtml(String(initPct.fat ?? ""))}" />
        </label>
      </div>
      <div id="nut-calc">${macroCalcHtml(cur.calories ?? "", initPct)}</div>
      <label style="margin-top:0.7em">Notes
        <textarea id="nut-notes" rows="2" placeholder="Meal timing, supplements, hydration…">${escapeHtml(cur.notes || "")}</textarea>
      </label>
      <div id="nut-chart-preview">${macroDonutHtml(cur)}</div>
      <button class="btn btn-primary" id="btn-save-nutrition" style="margin-top:0.7em">Save plan</button>`;
    container.appendChild(card);

    const readPcts = () => ({
      protein: $("#nut-protein-pct").value.trim(),
      carbs: $("#nut-carbs-pct").value.trim(),
      fat: $("#nut-fat-pct").value.trim(),
    });
    const refreshCalc = () => {
      const cal = $("#nut-cal").value.trim();
      const pcts = readPcts();
      $("#nut-calc").innerHTML = macroCalcHtml(cal, pcts);
      $("#nut-chart-preview").innerHTML = macroDonutHtml({ calories: cal, ...pctToGrams(cal, pcts) });
    };
    ["nut-cal", "nut-protein-pct", "nut-carbs-pct", "nut-fat-pct"].forEach((id) => {
      $("#" + id).addEventListener("input", refreshCalc);
    });
    $("#btn-save-nutrition").addEventListener("click", () => {
      const calories = $("#nut-cal").value.trim();
      const pcts = readPcts();
      const grams = pctToGrams(calories, pcts);
      const sumPct = MACROS.reduce((n, m) => n + (Number(pcts[m.key]) || 0), 0);
      if (!calories) { toast("Enter a daily calorie target"); return; }
      if (sumPct !== 100) {
        if (!window.confirm(`Your macros add up to ${sumPct}%, not 100%. Save anyway?`)) return;
      }
      const plan = {
        calories,
        proteinPct: pcts.protein, carbsPct: pcts.carbs, fatPct: pcts.fat,
        protein: grams.protein, carbs: grams.carbs, fat: grams.fat,
        notes: $("#nut-notes").value.trim(),
        effectiveFrom: todayISO(),
      };
      const prev = c.nutrition.current;
      const changed = !prev || ["calories", "proteinPct", "carbsPct", "fatPct", "notes"].some(
        (k) => String(prev[k] ?? "") !== String(plan[k] ?? ""));
      if (!changed) { toast("No changes to save"); return; }
      // Same-day edits are corrections, not a new era — don't spam history.
      if (prev && prev.effectiveFrom !== plan.effectiveFrom && (prev.calories || prev.protein)) {
        c.nutrition.history.push({ ...prev, endedAt: todayISO() });
      }
      c.nutrition.current = plan;
      saveTrainer();
      renderDiet();
      toast("Nutrition plan saved ✓");
    });

    if (c.nutrition.history.length) {
      const hist = document.createElement("div");
      hist.className = "card";
      hist.innerHTML = `<h4 style="margin-top:0">History</h4>`;
      [...c.nutrition.history].reverse().forEach((h) => {
        hist.insertAdjacentHTML("beforeend", `
          <div class="nutrition-history-row">
            <strong>${escapeHtml(nutritionPlanSummary(h))}</strong>
            <span class="muted">${escapeHtml(h.effectiveFrom || "")} → ${escapeHtml(h.endedAt || "")}</span>
          </div>`);
      });
      container.appendChild(hist);
    }

    // Athlete's logged body weight (read-only) — lives with nutrition now.
    const bwLog = c.importedProgress?.bodyweightLog || [];
    const bwCard = document.createElement("div");
    bwCard.className = "card";
    bwCard.style.marginTop = "1.75rem";
    bwCard.innerHTML = `<h4 style="margin-top:0">Body weight</h4>`;
    if (bwLog.length) {
      const charts = document.createElement("div");
      charts.id = "bw-charts-coach";
      bwCard.appendChild(charts);
      renderBwCharts(charts, bwLog);
      const list = document.createElement("div");
      list.className = "bw-list";
      [...bwLog].sort(bwSort).forEach((b) => {
        list.appendChild(bwEntryEl(b, { deletable: false }));
      });
      bwCard.appendChild(list);
    } else {
      bwCard.insertAdjacentHTML("beforeend",
        `<p class="muted" style="margin:0.2em 0 0">No weight entries yet. ${escapeHtml(c.name)} hasn't logged any body weight.</p>`);
    }
    container.appendChild(bwCard);
  }

  // -------- Calendar shared helpers --------
  function findWeekDay(c, weekId, dayId) {
    const w = c.weeks.find((x) => x.id === weekId);
    if (!w) return null;
    const d = w.days.find((x) => x.id === dayId);
    if (!d) return null;
    return { week: w, day: d };
  }

  function buildMonthGrid(year, month) {
    const first = new Date(year, month, 1);
    const startDow = first.getDay(); // 0=Sun
    const cells = [];
    // 6 weeks max, 42 cells
    const gridStart = new Date(year, month, 1 - startDow);
    for (let i = 0; i < 42; i++) {
      const d = new Date(gridStart);
      d.setDate(gridStart.getDate() + i);
      cells.push(d);
    }
    return cells;
  }

  const MONTH_NAMES = ["January","February","March","April","May","June","July","August","September","October","November","December"];
  const DOW_LABELS = ["Sun","Mon","Tue","Wed","Thu","Fri","Sat"];

  // Map "YYYY-MM-DD" → redemption entries so both calendars can pin a token
  // pill on the days a paid session was used.
  function redemptionsByDate(client) {
    const map = {};
    (client?.sessionBank?.redemptions || []).forEach((r) => {
      if (!r?.date) return;
      (map[r.date] = map[r.date] || []).push(r);
    });
    return map;
  }
  function tokenPillHtml(reds) {
    // Symbol only (session used) — the day cell stays compact; count shown
    // when more than one. Full notes on tap via openRedemptionDetailsModal.
    const label = reds.length > 1 ? `🎟×${reds.length}` : "🎟";
    const notes = reds.map((r) => r.note).filter(Boolean).join(" · ");
    return `<div class="cal-day-pill cal-day-pill-token" title="${escapeHtml(notes)}">${label}</div>`;
  }
  function openRedemptionDetailsModal(iso, reds, missed = []) {
    const items = [
      ...reds.map((r) => `<li>${r.note ? escapeHtml(r.note) : `<span class="muted">No note</span>`}</li>`),
      ...missed.map((m) => m.type === "closecall"
        ? `<li>🤝 Close call: free missed session (monthly freebie, no charge)</li>`
        : `<li>✕ Missed session: charged</li>`),
    ].join("");
    openModal({
      title: `${reds.length ? "🎟" : "🤝"} Session · ${iso}`,
      body: `
        <p class="muted" style="margin-top:-0.4em">What happened on this day:</p>
        <ul class="redemption-note-list">${items}</ul>`,
      actions: [{ label: "Close", className: "btn btn-ghost", onClick: closeModal }],
    });
  }

  // -------- Missed sessions: close-call freebie vs charged --------
  // Marked by the coach from the dashboard calendar's day modal. "closecall"
  // is the one-free-per-month pass: it waives the session charge (removing
  // the auto-redeemed token if it already fired — auto-redeem skips waived
  // bookings from then on). "charged" keeps the token spend and just makes
  // the paid-but-missed session visible on both calendars. Markers live on
  // sessionBank.missedSessions (coach-write-only jsonb, syncs to the athlete).
  function missedByDate(client) {
    const map = {};
    (client?.sessionBank?.missedSessions || []).forEach((m) => {
      if (!m?.date) return;
      (map[m.date] = map[m.date] || []).push(m);
    });
    return map;
  }
  function missedPillHtml(list) {
    return list.map((m) => m.type === "closecall"
      ? `<div class="cal-day-pill cal-day-pill-closecall" title="Close call: free missed session">🤝 Close call</div>`
      : `<div class="cal-day-pill cal-day-pill-missed" title="Missed session: charged">✕ Missed</div>`).join("");
  }
  function closeCallUsedInMonth(c, monthKey) {
    return (c.sessionBank.missedSessions || []).some((m) =>
      m.type === "closecall" && (m.date || "").slice(0, 7) === monthKey);
  }
  // Persist + cloud-push one athlete's trainer-side data (session bank edits).
  function pushAthleteBank(c) {
    bankMutated(c);
    localStorage.setItem(KEY_TRAINER, JSON.stringify(state.trainerData));
    if (window.Cloud?.enabled) window.Cloud.debounce(`athlete:${c.id}`, () =>
      window.Cloud.upsertAthlete(c, state.trainerData.coachId));
  }
  function markBookingMissed(e, c, type) {
    ensureSessionBank(c);
    const date = dateISO(new Date(e.startAt));
    const monthKey = date.slice(0, 7);
    if (type === "closecall") {
      if (closeCallUsedInMonth(c, monthKey) &&
          !window.confirm(`${c.name} already used their free close call this month. Give another one anyway?`)) return;
      // Waive the charge — drop the auto-redeemed token for this booking.
      c.sessionBank.redemptions = c.sessionBank.redemptions.filter((r) => !e.uid || r.setmoreUid !== e.uid);
    } else {
      // Charged: make sure the token is spent even if auto-redeem hasn't run
      // yet, and label it so the athlete sees why.
      const existing = c.sessionBank.redemptions.find((r) => e.uid && r.setmoreUid === e.uid);
      if (existing) existing.note = `Missed session: charged · ${fmtSetmoreTime(e.startAt)}`;
      else c.sessionBank.redemptions.push({
        id: uid(), date,
        note: `Missed session: charged · ${fmtSetmoreTime(e.startAt)}`,
        setmoreUid: e.uid || "",
      });
    }
    c.sessionBank.missedSessions.push({ id: uid(), date, setmoreUid: e.uid || "", type, at: Date.now() });
    pushAthleteBank(c);
    toast(type === "closecall"
      ? `🤝 Close call: ${c.name}'s monthly freebie used`
      : `✕ Marked missed. Session still charged`);
    closeModal();
    renderDashboardCalendar();
  }
  function unmarkBookingMissed(e, c) {
    ensureSessionBank(c);
    const m = (c.sessionBank.missedSessions || []).find((x) => e.uid && x.setmoreUid === e.uid);
    if (!m) return;
    c.sessionBank.missedSessions = c.sessionBank.missedSessions.filter((x) => x !== m);
    // A cleared close call becomes a normal finished booking again — the next
    // auto-redeem pass re-spends the token. A cleared "charged" keeps its
    // redemption (the slot was still used).
    pushAthleteBank(c);
    toast("Missed-session mark removed");
    closeModal();
    renderDashboardCalendar();
  }

  // -------- Auto-renew: monthly package sized from booked sessions --------
  // Opt-in per athlete (Profile → 🔁 Auto-renew). On the first app open in a
  // new month, grants a PENDING package sized to that athlete's matched
  // Setmore bookings this month — the coach marks it paid when money changes
  // hands. Same once-per-month dedupe idea as the manual grant button.
  function runAutoRenewGrants(year, month) {
    const now = new Date();
    if (year !== now.getFullYear() || month !== now.getMonth()) return;
    const monthKey = `${year}-${String(month + 1).padStart(2, "0")}`;
    const monthLabel = now.toLocaleDateString("en-US", { month: "long", year: "numeric" });
    const renewed = [];
    (state.trainerData.clients || []).forEach((c) => {
      if (!c.sessionBank?.autoRenew) return;
      ensureSessionBank(c);
      const already = c.sessionBank.packages.some((p) =>
        p.membershipGrant === monthKey || p.autoRenewGrant === monthKey);
      if (already) return;
      const count = _dashCalSetmoreEvents.filter((e) =>
        dateISO(new Date(e.startAt)).slice(0, 7) === monthKey &&
        matchAthleteBySetmoreName(e.clientName) === c
      ).length;
      if (!count) return;
      const m = membershipById(c.sessionBank.membership);
      const perSession = m && m.price && m.sessions ? Math.round(m.price / m.sessions) : 0;
      c.sessionBank.packages.push({
        id: uid(), size: count, status: "pending",
        addedAt: Date.now(),
        price: perSession ? perSession * count : undefined,
        note: `Auto-renew · ${monthLabel} · ${count} booked session${count === 1 ? "" : "s"}`,
        autoRenewGrant: monthKey,
      });
      renewed.push(c);
      // Mirror now so the partner's own pass sees the grant and skips it.
      bankMutated(c);
    });
    if (!renewed.length) return;
    localStorage.setItem(KEY_TRAINER, JSON.stringify(state.trainerData));
    renewed.forEach((c) => {
      if (window.Cloud?.enabled) window.Cloud.debounce(`athlete:${c.id}`, () =>
        window.Cloud.upsertAthlete(c, state.trainerData.coachId));
    });
    toast(`🔁 Auto-renew: ${renewed.map((c) => c.name).join(", ")} · ${monthLabel} package${renewed.length === 1 ? "" : "s"} added (pending payment)`, 4000);
  }

  // -------- Dashboard overview calendar --------
  // Setmore-synced booking times for the currently visible month, grouped
  // by local calendar date (see loadDashCalSetmoreEvents).
  let _dashCalSetmoreEvents = [];
  let _dashCalSetmoreFetchKey = null;

  function dashCalSetmoreByDate() {
    const map = {};
    _dashCalSetmoreEvents.forEach((e) => {
      const iso = dateISO(new Date(e.startAt));
      (map[iso] = map[iso] || []).push(e);
    });
    return map;
  }

  async function loadDashCalSetmoreEvents(year, month) {
    if (!window.Cloud?.enabled || !state.trainerData.coachId) return;
    const rangeStart = new Date(year, month, 1 - 7);
    const rangeEnd = new Date(year, month + 1, 7);
    const events = await window.Cloud.getSetmoreEvents(
      state.trainerData.coachId, rangeStart.toISOString(), rangeEnd.toISOString()
    );
    _dashCalSetmoreEvents = events;
    autoRedeemFinishedBookings();
    runAutoRenewGrants(year, month);
    syncUpcomingBookingsToAthletes();
    // Only re-render if still on the same month (avoid clobbering a nav that happened mid-fetch)
    if (state.dashCal && state.dashCal.year === year && state.dashCal.month === month) {
      renderDashboardCalendar();
    }
  }

  // -------- Setmore booking ↔ athlete profile matching --------
  function normSetmoreName(s) {
    return String(s || "").toLowerCase().replace(/\s+/g, " ").trim();
  }
  // Match by athlete name or a saved alias (aliases are added via the
  // "Link" action on unmatched bookings in the day modal).
  function matchAthleteBySetmoreName(name) {
    const n = normSetmoreName(name);
    if (!n) return null;
    return (state.trainerData.clients || []).find((c) =>
      normSetmoreName(c.name) === n ||
      (Array.isArray(c.setmoreAliases) && c.setmoreAliases.includes(n))
    ) || null;
  }

  // Auto-spend a session token for each matched booking that has finished.
  // Guards: never charges bookings that ended before the feature was enabled
  // (autoRedeemSince watermark), one redemption per booking (setmoreUid),
  // and skipped when the coach already logged a manual redemption for that
  // athlete on that date.
  function autoRedeemFinishedBookings() {
    const since = state.trainerData.autoRedeemSince;
    if (!since || !(state.trainerData.clients || []).length) return;
    const now = Date.now();
    const spent = [];
    _dashCalSetmoreEvents.forEach((e) => {
      if (!e.uid) return;
      const end = new Date(e.endAt || e.startAt).getTime();
      if (!(end > since && end <= now)) return;
      const c = matchAthleteBySetmoreName(e.clientName);
      if (!c) return;
      ensureSessionBank(c);
      const date = dateISO(new Date(e.startAt));
      const reds = c.sessionBank.redemptions;
      if (reds.some((r) => r.setmoreUid === e.uid)) return;
      if (reds.some((r) => !r.setmoreUid && r.date === date)) return;
      // Close-called bookings are waived — never auto-charge them.
      if ((c.sessionBank.missedSessions || []).some((m) => m.setmoreUid === e.uid && m.type === "closecall")) return;
      reds.push({
        id: uid(), date,
        note: `Booked session · ${fmtSetmoreTime(e.startAt)}`,
        setmoreUid: e.uid,
      });
      spent.push(c);
      bankMutated(c);
    });
    if (!spent.length) return;
    localStorage.setItem(KEY_TRAINER, JSON.stringify(state.trainerData));
    // Push each charged athlete (saveTrainer only pushes the open one)
    if (window.Cloud?.enabled) {
      spent.forEach((c) => window.Cloud.debounce(`athlete:${c.id}`, () =>
        window.Cloud.upsertAthlete(c, state.trainerData.coachId)
      ));
    }
    toast(`🎟 Session token spent: ${spent.map((c) => c.name).join(", ")}`);
    if (state.currentClientId && spent.some((c) => c.id === state.currentClientId)) {
      renderCoachSessions();
      renderCoachCalendar();
    }
  }

  // Store each athlete's upcoming (future) matched bookings on their record so
  // they appear on the athlete's own calendar. Rides the session_bank jsonb
  // (no schema change). Best-effort: reflects bookings in the loaded window,
  // merged with previously-seen future bookings so navigating months doesn't
  // drop them; past ones fall off.
  function syncUpcomingBookingsToAthletes() {
    const clients = state.trainerData.clients || [];
    if (!clients.length) return;
    const now = Date.now();
    const today = todayISO();
    const windowUids = new Set(_dashCalSetmoreEvents.map((e) => e.uid).filter(Boolean));
    const byAthlete = {};
    _dashCalSetmoreEvents.forEach((e) => {
      if (!e.uid || !e.startAt) return;
      if (new Date(e.startAt).getTime() <= now) return; // future only
      const c = matchAthleteBySetmoreName(e.clientName);
      if (!c) return;
      (byAthlete[c.id] = byAthlete[c.id] || []).push({
        uid: e.uid, date: dateISO(new Date(e.startAt)), time: fmtSetmoreTime(e.startAt), startAt: e.startAt,
      });
    });
    // Linked partners share bookings: the couple's slot is booked under one
    // name, but it belongs on both athletes' calendars.
    clients.forEach((c) => {
      const p = partnerOf(c);
      if (!p || !(byAthlete[p.id] || []).length) return;
      const mine = (byAthlete[c.id] = byAthlete[c.id] || []);
      byAthlete[p.id].forEach((b) => {
        if (!mine.some((x) => x.uid === b.uid)) mine.push(b);
      });
    });
    let anyChanged = false;
    clients.forEach((c) => {
      ensureSessionBank(c);
      // Keep still-future bookings from earlier windows (not re-fetched now),
      // then add this window's matches.
      const kept = c.sessionBank.upcomingBookings.filter((b) => b.date >= today && !windowUids.has(b.uid));
      const merged = [...kept, ...(byAthlete[c.id] || [])]
        .sort((a, b) => new Date(a.startAt) - new Date(b.startAt));
      const key = (arr) => arr.map((b) => b.uid + b.date).join(",");
      if (key(merged) !== key(c.sessionBank.upcomingBookings)) {
        c.sessionBank.upcomingBookings = merged;
        anyChanged = true;
        if (window.Cloud?.enabled) window.Cloud.debounce(`athlete:${c.id}`, () =>
          window.Cloud.upsertAthlete(c, state.trainerData.coachId)
        );
      }
    });
    if (anyChanged) localStorage.setItem(KEY_TRAINER, JSON.stringify(state.trainerData));
  }

  function openLinkSetmoreNameModal(bookingName) {
    const clients = state.trainerData.clients || [];
    if (!clients.length) { toast("No athletes to link yet"); return; }
    const rows = clients.map((c) => `
      <button class="day-log-opt" type="button" data-link-athlete="${escapeHtml(c.id)}">
        <span class="day-log-name">${escapeHtml(c.name)}</span>
      </button>`).join("");
    openModal({
      title: `Link "${escapeHtml(bookingName)}"`,
      body: `
        <p class="muted" style="margin-top:-0.4em">Pick which athlete this Setmore booking name belongs to. Future bookings under this name will match automatically (and their finished sessions will use a token).</p>
        <div class="day-log-picker">${rows}</div>`,
      actions: [{ label: "Cancel", className: "btn btn-ghost", onClick: closeModal }],
    });
    $$("[data-link-athlete]").forEach((btn) => {
      btn.addEventListener("click", () => {
        const c = clients.find((x) => x.id === btn.dataset.linkAthlete);
        if (!c) return;
        if (!Array.isArray(c.setmoreAliases)) c.setmoreAliases = [];
        const n = normSetmoreName(bookingName);
        if (!c.setmoreAliases.includes(n)) c.setmoreAliases.push(n);
        saveTrainer();
        if (window.Cloud?.enabled) window.Cloud.debounce(`athlete:${c.id}`, () =>
          window.Cloud.upsertAthlete(c, state.trainerData.coachId)
        );
        closeModal();
        toast(`Linked to ${c.name} ✓`);
        autoRedeemFinishedBookings();
        renderDashboardCalendar();
      });
    });
  }

  async function refreshDashCalSetmore() {
    const btn = $("#dash-cal-refresh");
    if (btn) { btn.disabled = true; btn.textContent = "Syncing…"; }
    await window.Cloud?.refreshSetmoreSync?.();
    _dashCalSetmoreFetchKey = null; // force the next render to re-fetch
    if (state.dashCal) await loadDashCalSetmoreEvents(state.dashCal.year, state.dashCal.month);
    if (btn) { btn.disabled = false; btn.textContent = "🔄 Refresh"; }
    toast("Calendar synced");
  }

  function renderDashboardCalendar() {
    if (!state.dashCal) { const n = new Date(); state.dashCal = { year: n.getFullYear(), month: n.getMonth() }; }
    const { year, month } = state.dashCal;
    const fetchKey = `${year}-${month}`;
    if (window.Cloud?.enabled && state.trainerData.coachId && _dashCalSetmoreFetchKey !== fetchKey) {
      _dashCalSetmoreFetchKey = fetchKey;
      loadDashCalSetmoreEvents(year, month);
    }
    $("#dash-cal-title").textContent = `${MONTH_NAMES[month]} ${year}`;
    const grid = $("#dash-cal-grid");
    grid.innerHTML = "";
    DOW_LABELS.forEach(d => {
      const el = document.createElement("div");
      el.className = "cal-dow";
      el.textContent = d;
      grid.appendChild(el);
    });
    const cells = buildMonthGrid(year, month);
    const today = todayISO();
    const clients = state.trainerData.clients || [];
    const setmoreByDate = dashCalSetmoreByDate();
    cells.forEach(d => {
      const iso = dateISO(d);
      const inMonth = d.getMonth() === month;
      const cell = document.createElement("div");
      cell.className = "dash-cal-day";
      if (!inMonth) { cell.classList.add("outside"); cell.innerHTML = `<div class="dash-cal-date">${d.getDate()}</div>`; grid.appendChild(cell); return; }
      if (iso === today) cell.classList.add("today");
      const entries = [];
      clients.forEach(c => {
        const entry = c.importedProgress?.selfSchedule?.[iso];
        if (!entry) return;
        if (entry.rest) { entries.push({ client: c, rest: true, dc: null }); return; }
        if (!entry.weekId) return;
        const dIdx = getDayIdx(c, entry.weekId, entry.dayId);
        const dc = getDayColor(dIdx);
        const wd = findWeekDay(c, entry.weekId, entry.dayId);
        entries.push({ client: c, dayName: wd?.day.name || "Workout", dc, weekId: entry.weekId, dayId: entry.dayId });
      });
      const MAX_SHOW = 4;
      const shown = entries.slice(0, MAX_SHOW);
      const overflow = entries.length - MAX_SHOW;
      let html = `<div class="dash-cal-date">${d.getDate()}</div>`;
      shown.forEach(e => {
        if (e.rest) {
          html += `<div class="dash-cal-pill dash-cal-pill-rest"><span class="dash-cal-initials">${escapeHtml(clientInitials(e.client.name))}</span><span class="dash-cal-day-name">Rest</span></div>`;
        } else {
          html += `<div class="dash-cal-pill" style="--day-color:${e.dc.color};--day-color-soft:${e.dc.soft}"><span class="dash-cal-initials">${escapeHtml(clientInitials(e.client.name))}</span><span class="dash-cal-day-name">${escapeHtml(e.dayName)}</span></div>`;
        }
      });
      if (overflow > 0) html += `<div class="dash-cal-more">+${overflow} more</div>`;
      const setmoreEvents = setmoreByDate[iso] || [];
      if (setmoreEvents.length) {
        html += `<div class="dash-cal-pill dash-cal-pill-booked">📅 ${setmoreEvents.length} booked</div>`;
      }
      // Missed-session marks (any athlete): green close call / dark charged
      clients.forEach((c) => {
        (c.sessionBank?.missedSessions || []).forEach((m) => {
          if (m.date !== iso) return;
          html += m.type === "closecall"
            ? `<div class="dash-cal-pill cal-day-pill-closecall" title="${escapeHtml(c.name)}: close call (free)">🤝 ${escapeHtml(clientInitials(c.name))}</div>`
            : `<div class="dash-cal-pill cal-day-pill-missed" title="${escapeHtml(c.name)}: missed, charged">✕ ${escapeHtml(clientInitials(c.name))}</div>`;
        });
      });
      // Mobile shows a compact count badge instead of pills (CSS swaps them)
      const dayCount = entries.filter(e => !e.rest).length + setmoreEvents.length;
      if (dayCount) html += `<div class="dash-cal-count">${dayCount}</div>`;
      cell.innerHTML = html;
      const workoutEntries = entries.filter(e => !e.rest);
      if (workoutEntries.length || setmoreEvents.length) {
        cell.classList.add("has-log");
        cell.addEventListener("click", () => openDashboardDayModal(iso));
      }
      grid.appendChild(cell);
    });
  }

  function fmtSetmoreTime(iso) {
    return new Date(iso).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  }

  function openDashboardDayModal(iso) {
    const clients = state.trainerData.clients || [];
    let body = "";
    const dayEvents = (dashCalSetmoreByDate()[iso] || [])
      .slice()
      .sort((a, b) => new Date(a.startAt) - new Date(b.startAt));
    if (dayEvents.length) {
      body += `<div class="dash-breakdown-client">
        <div class="dash-breakdown-header"><strong>📅 Booked sessions</strong></div>`;
      dayEvents.forEach((e, i) => {
        const athlete = matchAthleteBySetmoreName(e.clientName);
        const time = `<span class="breakdown-set-pill">${escapeHtml(fmtSetmoreTime(e.startAt))}</span>`;
        if (athlete) {
          const sum = sessionBankSummary(athlete);
          const mark = (athlete.sessionBank?.missedSessions || []).find((m) => e.uid && m.setmoreUid === e.uid);
          const missedUi = mark
            ? `<span class="missed-chip ${mark.type === "closecall" ? "closecall" : "charged"}">${mark.type === "closecall" ? "🤝 Close call" : "✕ Missed · charged"}</span>
               <button class="btn-missed-mark" type="button" data-unmark-missed="${i}" title="Remove this mark">↺</button>`
            : `<button class="btn-missed-mark cc" type="button" data-miss-cc="${i}" title="Close call: use their free missed session for this month (no charge)">🤝</button>
               <button class="btn-missed-mark chg" type="button" data-miss-charge="${i}" title="Missed: session is still charged">✕</button>`;
          body += `<div class="breakdown-ex dash-booked-row dash-booked-linked" data-open-athlete="${escapeHtml(athlete.id)}">
            <div class="breakdown-ex-name">${escapeHtml(athlete.name)}
              <span class="booked-balance-chip${sum.remaining <= 0 ? " low" : ""}">🎟 ${sum.remaining} left</span>
            </div>
            <div class="breakdown-sets">${time}
              ${missedUi}
              <button class="btn-unlink-setmore" type="button" data-unlink-booking="${i}" title="Unlink this booking from ${escapeHtml(athlete.name)}">Unlink</button>
              <span class="dash-booked-arrow">›</span>
            </div>
          </div>`;
        } else {
          body += `<div class="breakdown-ex dash-booked-row">
            <div class="breakdown-ex-name">${escapeHtml(e.clientName)}</div>
            <div class="breakdown-sets">${time}
              <button class="btn btn-ghost btn-sm" type="button" data-link-booking="${escapeHtml(String(i))}">Link…</button>
            </div>
          </div>`;
        }
      });
      body += `</div>`;
    }
    clients.forEach(c => {
      const entry = c.importedProgress?.selfSchedule?.[iso];
      if (!entry || !entry.weekId) return;
      const wd = findWeekDay(c, entry.weekId, entry.dayId);
      if (!wd) return;
      const { week, day } = wd;
      const dIdx = getDayIdx(c, entry.weekId, entry.dayId);
      const dc = getDayColor(dIdx);
      const logs = c.importedProgress?.exerciseLogs || {};
      body += `<div class="dash-breakdown-client">
        <div class="dash-breakdown-header">
          <span class="dash-breakdown-dot" style="background:${dc.color}"></span>
          <strong>${escapeHtml(c.name)}</strong>
          <span class="muted" style="font-size:0.82rem;margin-left:auto">${escapeHtml(week.label)} · ${escapeHtml(day.name)}</span>
        </div>`;
      day.exercises.forEach(ex => {
        const logEntry = (logs[ex.id] || []).find(l => l.date === iso);
        body += `<div class="breakdown-ex"><div class="breakdown-ex-name">${escapeHtml(ex.name)}</div><div class="breakdown-sets">`;
        if (logEntry?.sets?.length) {
          logEntry.sets.forEach((s, i) => {
            if (s.weight || s.reps) body += `<span class="breakdown-set-pill">S${i+1} ${s.weight ? escapeHtml(String(s.weight)) + " lb" : "—"} × ${s.reps || "—"}</span>`;
          });
        } else if (logEntry?.weight || logEntry?.reps) {
          body += `<span class="breakdown-set-pill">${logEntry.weight ? escapeHtml(String(logEntry.weight)) + " lb" : "—"} × ${logEntry.reps || "—"}</span>`;
        } else {
          body += `<span style="font-size:0.8rem;color:var(--muted)">Not logged</span>`;
        }
        body += `</div></div>`;
      });
      const dayNote = c.importedProgress?.dayNotes?.[day.id];
      if (dayNote) body += `<div class="breakdown-note"><span class="breakdown-note-label">Session note</span><p>${escapeHtml(dayNote)}</p></div>`;
      body += `</div>`;
    });
    if (!body) body = `<p class="muted">Nothing scheduled or logged for this date.</p>`;
    openModal({ title: iso, body, actions: [{ label: "Close", className: "btn btn-ghost", onClick: closeModal }] });
    // Matched booking → jump to that athlete's profile
    $$("[data-open-athlete]").forEach((row) => {
      row.addEventListener("click", () => {
        closeModal();
        openClient(row.dataset.openAthlete);
      });
    });
    // Unmatched booking → save an alias on the right athlete
    $$("[data-link-booking]").forEach((btn) => {
      btn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        const e = dayEvents[Number(btn.dataset.linkBooking)];
        if (e) openLinkSetmoreNameModal(e.clientName);
      });
    });
    // Matched-by-alias booking → unlink (remove the alias that caused the match)
    $$("[data-unlink-booking]").forEach((btn) => {
      btn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        const e = dayEvents[Number(btn.dataset.unlinkBooking)];
        if (e) unlinkSetmoreBooking(e.clientName);
      });
    });
    // Missed-session marks: close call (free) / missed but charged / undo
    const missedHandler = (attr, fn) => $$(`[data-${attr}]`).forEach((btn) => {
      btn.addEventListener("click", (ev) => {
        ev.stopPropagation();
        const e = dayEvents[Number(btn.getAttribute(`data-${attr}`))];
        const a = e && matchAthleteBySetmoreName(e.clientName);
        if (e && a) fn(e, a);
      });
    });
    missedHandler("miss-cc", (e, a) => markBookingMissed(e, a, "closecall"));
    missedHandler("miss-charge", (e, a) => markBookingMissed(e, a, "charged"));
    missedHandler("unmark-missed", (e, a) => unmarkBookingMissed(e, a));
  }

  // Disconnect a Setmore booking name from an athlete by removing the alias
  // that was linking them. If the booking matches the athlete's actual name
  // (not an alias) there's nothing to remove — tell the coach.
  function unlinkSetmoreBooking(bookingName) {
    const c = matchAthleteBySetmoreName(bookingName);
    if (!c) return;
    const n = normSetmoreName(bookingName);
    const viaAlias = Array.isArray(c.setmoreAliases) && c.setmoreAliases.includes(n);
    if (!viaAlias) {
      toast(`"${bookingName}" matches ${c.name}'s own name. Rename the athlete or the Setmore booking to unlink.`);
      return;
    }
    if (!window.confirm(`Unlink "${bookingName}" from ${c.name}? Future bookings under this name won't match ${c.name} (and won't auto-spend a session).`)) return;
    c.setmoreAliases = c.setmoreAliases.filter((a) => a !== n);
    saveTrainer();
    if (window.Cloud?.enabled) window.Cloud.debounce(`athlete:${c.id}`, () =>
      window.Cloud.upsertAthlete(c, state.trainerData.coachId)
    );
    toast(`Unlinked from ${c.name} ✓`);
    closeModal();
    renderDashboardCalendar();
  }

  // -------- Coach calendar --------
  function renderCoachCalendar() {
    const c = currentClient(); if (!c) return;
    const { year, month } = state.coachCal;
    $("#cal-title").textContent = `${MONTH_NAMES[month]} ${year}`;
    const grid = $("#cal-grid");
    grid.innerHTML = "";
    DOW_LABELS.forEach((d) => {
      const el = document.createElement("div");
      el.className = "cal-dow";
      el.textContent = d;
      grid.appendChild(el);
    });
    const cells = buildMonthGrid(year, month);
    const today = todayISO();
    const selfSched = c.importedProgress?.selfSchedule || {};
    const redsByDate = redemptionsByDate(c);
    cells.forEach((d) => {
      const iso = dateISO(d);
      const inMonth = d.getMonth() === month;
      const cell = document.createElement("div");
      cell.className = "cal-day";
      if (!inMonth) cell.classList.add("outside");
      if (iso === today) cell.classList.add("today");
      const entry = selfSched[iso];
      let pillHtml = "";
      if (entry && entry.weekId) {
        const dIdx = getDayIdx(c, entry.weekId, entry.dayId);
        const dc = getDayColor(dIdx);
        const wd = findWeekDay(c, entry.weekId, entry.dayId);
        const name = wd?.day.name || "Workout";
        pillHtml = `<div class="cal-day-pill" style="--day-color:${dc.color};--day-color-soft:${dc.soft}">${escapeHtml(name)}</div>`;
        cell.classList.add("has-log");
      } else if (entry?.rest) {
        pillHtml = `<div class="cal-day-pill cal-day-pill-rest">Rest</div>`;
        cell.classList.add("has-log");
      }
      const reds = redsByDate[iso] || [];
      if (reds.length) pillHtml += tokenPillHtml(reds);
      cell.innerHTML = `<div class="cal-date-num">${d.getDate()}</div>${pillHtml}`;
      if (inMonth && entry && !entry.rest) {
        cell.addEventListener("click", () => openCoachDayBreakdown(iso, c));
      } else if (inMonth && reds.length) {
        cell.classList.add("has-log");
        cell.addEventListener("click", () => openRedemptionDetailsModal(iso, reds));
      }
      grid.appendChild(cell);
    });
  }

  function openCoachDayBreakdown(iso, c) {
    const entry = c.importedProgress?.selfSchedule?.[iso]; if (!entry || !entry.weekId) return;
    const wd = findWeekDay(c, entry.weekId, entry.dayId);
    if (!wd) {
      openModal({ title: iso, body: `<p class="muted">Day not found in current program.</p>`, actions: [{ label: "Close", className: "btn btn-ghost", onClick: closeModal }] });
      return;
    }
    const { week, day } = wd;
    const dIdx = getDayIdx(c, entry.weekId, entry.dayId);
    const dc = getDayColor(dIdx);
    const logs = c.importedProgress?.exerciseLogs || {};
    let bodyHtml = `<div style="display:flex;align-items:center;gap:0.5rem;margin-bottom:1rem">
      <span style="display:inline-block;width:10px;height:10px;border-radius:50%;background:${dc.color};flex-shrink:0"></span>
      <span class="muted" style="font-size:0.85rem">${escapeHtml(week.label)}</span>
    </div>`;
    if (!day.exercises.length) {
      bodyHtml += `<p class="muted">No exercises in this day.</p>`;
    } else {
      day.exercises.forEach(ex => {
        const logEntry = (logs[ex.id] || []).find(l => l.date === iso);
        bodyHtml += `<div class="breakdown-ex"><div class="breakdown-ex-name">${escapeHtml(ex.name)}</div><div class="breakdown-sets">`;
        if (logEntry?.sets?.length) {
          logEntry.sets.forEach((s, i) => {
            if (s.weight || s.reps) bodyHtml += `<span class="breakdown-set-pill">S${i+1} ${s.weight ? escapeHtml(String(s.weight)) + " lb" : "—"} × ${s.reps || "—"}</span>`;
          });
        } else if (logEntry?.weight || logEntry?.reps) {
          bodyHtml += `<span class="breakdown-set-pill">${logEntry.weight ? escapeHtml(String(logEntry.weight)) + " lb" : "—"} × ${logEntry.reps || "—"}</span>`;
        } else {
          bodyHtml += `<span style="font-size:0.8rem;color:var(--muted)">Not logged</span>`;
        }
        bodyHtml += `</div></div>`;
      });
    }
    const dayNote = c.importedProgress?.dayNotes?.[day.id];
    if (dayNote) bodyHtml += `<div class="breakdown-note"><span class="breakdown-note-label">Session note</span><p>${escapeHtml(dayNote)}</p></div>`;
    openModal({
      title: `${escapeHtml(day.name)} · ${iso}`,
      body: bodyHtml,
      actions: [{ label: "Close", className: "btn btn-ghost", onClick: closeModal }],
    });
  }

  // -------- Coach Cardio view (athlete's logged cardio only) --------
  function renderClientLogs() {
    const c = currentClient(); if (!c) return;
    const container = $("#logs-container");
    const empty = $("#logs-empty");
    container.innerHTML = "";
    const p = c.importedProgress;
    if (!p?.cardioLogs?.length) { show(empty); return; }
    hide(empty);

    const cardioCard = document.createElement("div");
    cardioCard.className = "log-week-card";
    cardioCard.innerHTML = `<h4>Cardio</h4>`;
    [...p.cardioLogs]
      .sort((a, b) => (b.date || "").localeCompare(a.date || ""))
      .forEach((log) => {
        const row = document.createElement("div");
        row.className = "cardio-row cardio-row-readonly";
        row.innerHTML = `
          <span class="cardio-row-icon">${cardioIcon(log.type)}</span>
          <div class="cardio-row-info">
            <strong>${escapeHtml(log.type || "Cardio")}</strong>
            <span class="muted">${escapeHtml(log.date || "")}${log.miles ? ` · ${escapeHtml(String(log.miles))} mi` : ""}</span>
          </div>
          <span class="cardio-min">${escapeHtml(String(log.minutes || 0))} min</span>
          <span class="cardio-intensity cardio-intensity-${escapeHtml((log.intensity || "moderate").toLowerCase())}">${escapeHtml(log.intensity || "Moderate")}</span>`;
        cardioCard.appendChild(row);
      });
    container.appendChild(cardioCard);
  }

  // -------- Personal Records --------
  function groupPRs(prs) {
    // Group by lowercase name, retain original-case display name from first entry
    const groups = new Map();
    prs.forEach((p) => {
      if (!p.name) return;
      const k = exKey(p.name);
      if (!groups.has(k)) groups.set(k, { displayName: p.name.trim(), entries: [] });
      groups.get(k).entries.push(p);
    });
    return Array.from(groups.values()).sort((a, b) => a.displayName.localeCompare(b.displayName));
  }
  // Rank sets/PRs by estimated 1RM (weighted) or reps (bodyweight), so a rep PR
  // at the same weight, or a lighter high-rep set, is scored correctly.
  function prSortKey(p) {
    return prIsRepOnly(p) ? (parseInt(p.reps, 10) || 0) : epley1RM(p.weight, p.reps);
  }
  // Dumbbell lifts read as a pair: "80s" means two 80 lb dumbbells.
  function isDumbbellLift(name) { return /\b(dbs?|dumbbells?)\b/i.test(String(name || "")); }
  // HTML-safe weight label for a lift: "80s" for dumbbell lifts, "225 lb" otherwise.
  function prWeightLabel(name, w) {
    if (!w) return "— lb";
    return isDumbbellLift(name) ? `${escapeHtml(w)}s` : `${escapeHtml(w)} lb`;
  }
  // "225 lb × 5" ("80s × 5" for dumbbells), or "5 reps" for bodyweight entries.
  function prValueLabel(p) {
    return prIsRepOnly(p)
      ? `${escapeHtml(p.reps || "?")} reps`
      : `${prWeightLabel(p.name, p.weight)} × ${escapeHtml(p.reps || "?")}`;
  }
  function renderPRGroup(group) {
    const sorted = [...group.entries].sort((a, b) => prSortKey(b) - prSortKey(a));
    const best = sorted[0];
    const card = document.createElement("div");
    card.className = "pr-exercise-group";
    const head = document.createElement("div");
    head.className = "pr-exercise-header";
    head.innerHTML = `
      <h4 class="pr-exercise-name">${escapeHtml(group.displayName)}</h4>
      ${best && (best.weight || best.reps) ? `<span class="pr-best"><span class="pr-best-label">PR</span>${prValueLabel(best)}</span>` : ""}
    `;
    card.appendChild(head);
    const realEntries = sorted.filter((p) => p.weight || p.reps);
    if (!realEntries.length) {
      const hint = document.createElement("div");
      hint.className = "pr-row pr-placeholder-hint";
      hint.textContent = "No PR logged yet";
      card.appendChild(hint);
    } else {
      realEntries.forEach((p, idx) => {
        const row = document.createElement("div");
        row.className = "pr-row" + (idx === 0 ? " is-best" : "");
        row.innerHTML = `
          <div><span class="pr-weight">${prIsRepOnly(p) ? (p.weight === "BW" ? "BW" : "—") : prWeightLabel(p.name, p.weight)}</span> <span class="pr-reps">× ${escapeHtml(p.reps || "—")} reps</span>${p.auto ? `<span class="pr-auto" title="Auto-detected from your logged sets">auto</span>` : ""}</div>
          <div class="pr-date">${escapeHtml(p.date || "")}</div>
          <span class="pr-author ${p._author || "coach"}">${(p._author || "coach")}</span>
          <button class="pr-delete" data-id="${p.id}" data-author="${p._author || ""}" title="Delete">×</button>
          ${p.notes ? `<div class="pr-notes">${escapeHtml(p.notes)}</div>` : ""}
        `;
        card.appendChild(row);
      });
    }
    return card;
  }

  // "07/14/26" from "2026-07-14" — PR date fields use the short form.
  function shortFromISO(iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso || ""));
    return m ? `${m[2]}/${m[3]}/${m[1].slice(2)}` : "";
  }

  // Best weight actually logged for ≥1 / ≥2 / ≥3 reps of a lift, across every
  // program copy of it (matched by exKey, same as auto-PR detection). Drafts
  // (locked === false) and skipped sets don't count; holds and timed carries
  // have no lb × reps to report.
  function bestLoggedByReps(name, weeks, logsMap) {
    const key = exKey(name);
    if (!key) return null;
    const best = { 1: null, 2: null, 3: null };
    (weeks || []).forEach((wk) => (wk.days || []).forEach((d) => (d.exercises || []).forEach((ex) => {
      if (exKey(ex.name) !== key || ex.kind === "mobility" || exIsTimed(ex)) return;
      ((logsMap || {})[ex.id] || []).forEach((l) => {
        if (l.locked === false || l.skipped) return;
        (l.sets || []).forEach((s) => {
          if (s.skipped) return;
          const w = parseFloat(s.weight), r = parseInt(s.reps, 10) || 0;
          if (!isFinite(w) || w <= 0 || !r) return;
          for (let n = 1; n <= 3; n++) {
            if (r >= n && (!best[n] || w > best[n].weight)) best[n] = { weight: w, date: l.date || "" };
          }
        });
      });
    })));
    return (best[1] || best[2] || best[3]) ? best : null;
  }

  // Picking a lift is enough — empty, unlocked slots fill themselves from the
  // logged best as workouts come in. Typed or locked values are never touched.
  function autoFillPRFromLogs(entry, best) {
    if (!best) return false;
    let changed = false;
    [1, 2, 3].forEach((n) => {
      const b = best[n];
      if (!b || entry[`pr${n}`] || entry[`pr${n}Locked`]) return;
      entry[`pr${n}`] = String(b.weight);
      entry[`pr${n}Date`] = shortFromISO(b.date);
      changed = true;
    });
    return changed;
  }

  // Chip shown on a slot when the logged best beats the recorded PR — one tap
  // records it. Hidden on locked slots.
  function prLoggedChip(entry, n, best) {
    const b = best?.[n];
    if (!b || entry[`pr${n}Locked`]) return "";
    const cur = parseFloat(entry[`pr${n}`]);
    if (isFinite(cur) && cur >= b.weight) return "";
    const dt = shortFromISO(b.date);
    return `<button class="pr-logged-chip" data-slot="${n}" type="button"
      title="Best from logged workouts. Tap to record it.">🏋️ ${b.weight}${isDumbbellLift(entry.name) ? "s" : ""}${dt ? " · " + dt : ""}</button>`;
  }
  function wirePRLoggedChips(card, entry, best, onApply) {
    card.querySelectorAll(".pr-logged-chip").forEach((chip) => {
      chip.addEventListener("click", () => {
        const n = Number(chip.dataset.slot);
        const b = best?.[n];
        if (!b) return;
        entry[`pr${n}`] = String(b.weight);
        entry[`pr${n}Date`] = shortFromISO(b.date);
        toast("PR recorded from workout logs 🏆");
        onApply();
      });
    });
  }

  // A datalist of every pickable lift for PR tracking: the full library, the
  // coach's custom exercises, and anything in this athlete's program (which
  // catches custom/renamed lifts on the athlete side, where the coach's
  // custom list isn't available). Stretches are excluded — no lb PR there.
  function prExerciseDatalist(side) {
    let dl = document.getElementById("pr-ex-datalist");
    if (!dl) {
      dl = document.createElement("datalist");
      dl.id = "pr-ex-datalist";
      document.body.appendChild(dl);
    }
    const names = new Set(ALL_EXERCISE_NAMES.filter((n) => !HOLD_NAMES.has(n)));
    customExerciseList().forEach((cx) => { if (!HOLD_CATS.includes(cx.cat)) names.add(cx.name); });
    suggestExerciseNames(side).forEach((n) => { if (!isHoldName(n)) names.add(n); });
    dl.innerHTML = [...names].sort((a, b) => a.localeCompare(b))
      .map((n) => `<option value="${escapeHtml(n)}"></option>`).join("");
    return "pr-ex-datalist";
  }

  function renderCoachPRs() {
    const c = currentClient(); if (!c) return;
    const container = $("#coach-pr-container");
    const emptyEl = $("#coach-pr-empty");
    container.innerHTML = "";
    if (!c.coachPRs) c.coachPRs = [];

    // One coach entry per lift name (first match wins)
    const nameMap = new Map();
    c.coachPRs.forEach(p => {
      if (!p.name) return;
      const key = p.name.trim().toLowerCase();
      if (!nameMap.has(key)) nameMap.set(key, p);
    });

    // Best imported athlete PR per name
    const athleteBestMap = new Map();
    (c.importedProgress?.personalRecords || []).forEach(p => {
      if (!p.name) return;
      const key = p.name.trim().toLowerCase();
      const cur = athleteBestMap.get(key);
      if (!cur || Number(p.weight) > Number(cur.weight)) athleteBestMap.set(key, p);
    });

    const hasAnything = nameMap.size > 0 || _prNewLifts.length > 0 || athleteBestMap.size > 0;
    // Empty state and the + Add lift button coexist — an athlete with no PR
    // cards yet still needs the door in.
    if (hasAnything) hide(emptyEl); else show(emptyEl);

    // Logged-workout bests feed the cards: current program + archives + one-off
    // coach sessions (the pseudo-week wraps them for the by-week walker —
    // heavy session lifts are exactly what PR cards should pick up).
    const coachWeeks = [...(c.weeks || []), ...(c.archivedPrograms || []).flatMap((a) => a.weeks || []), { days: c.oneOffDays || [] }];
    const coachLogs = c.importedProgress?.exerciseLogs || {};

    // Coach-managed cards (editable)
    let autoFilled = false;
    nameMap.forEach((entry, key) => {
      const best = bestLoggedByReps(entry.name, coachWeeks, coachLogs);
      if (autoFillPRFromLogs(entry, best)) autoFilled = true;
      const inEdit = _prEditIds.has(entry.id) || !(entry.pr1 || entry.pr2 || entry.pr3);
      container.appendChild(buildCoachPRCard(c, entry, inEdit, false, athleteBestMap.get(key), best));
    });
    if (autoFilled) saveTrainer();

    // Read-only athlete-only lifts (no coach entry for this name)
    athleteBestMap.forEach((p, key) => {
      if (nameMap.has(key)) return;
      const card = document.createElement("div");
      card.className = "pr-edit-card pr-athlete-only";
      card.innerHTML = `
        <div class="pr-view-header">
          <h4 class="pr-exercise-name">${escapeHtml(p.name)}</h4>
          <span class="pr-author athlete">athlete</span>
        </div>
        <div class="pr-view-value">
          <span class="pr-weight">${escapeHtml(p.weight || "—")} lb</span>
          <span class="pr-reps">× ${escapeHtml(p.reps || "—")} reps</span>
          ${p.date ? `<span class="pr-date">${escapeHtml(p.date)}</span>` : ""}
        </div>`;
      container.appendChild(card);
    });

    // Unsaved new lift cards
    _prNewLifts.forEach(nl => {
      container.appendChild(buildCoachPRCard(c, { id: nl.tempId, name: "", weight: "", reps: "", date: "" }, true, true, null));
    });

    // + Add lift button
    const addBtn = document.createElement("button");
    addBtn.className = "btn btn-ghost pr-add-lift-btn";
    addBtn.textContent = "+ Add lift";
    addBtn.addEventListener("click", addPRLift);
    container.appendChild(addBtn);
  }

  function addPRLift() {
    _prNewLifts.push({ tempId: uid() });
    renderCoachPRs();
    setTimeout(() => {
      const cards = $$("#coach-pr-container .pr-edit-card");
      if (cards.length) cards[cards.length - 1].scrollIntoView({ behavior: "smooth", block: "nearest" });
    }, 50);
  }

  function buildCoachPRCard(c, entry, inEdit, isNew, athletePR, best) {
    const card = document.createElement("div");
    card.className = "pr-edit-card" + (isNew ? " is-editing" : " pr-shared-card");

    if (isNew) {
      // Create-new-lift card: name (picked from the library) + 3 values + Save.
      card.innerHTML = `
        <div class="pr-edit-name-row"><input class="pr-name-input" list="${prExerciseDatalist("coach")}" autocomplete="off" placeholder="Pick an exercise…" value="${escapeHtml(entry.name || "")}"></div>
        <div class="pr-edit-fields">
          <div class="pr-field-group">
            <label class="pr-field-label">1 Rep PR (lb)</label>
            <input class="pr-1rm-input" type="number" min="0" step="any" placeholder="e.g. 315">
          </div>
          <div class="pr-field-group">
            <label class="pr-field-label">2 Rep PR (lb)</label>
            <input class="pr-2rm-input" type="number" min="0" step="any" placeholder="e.g. 295">
          </div>
          <div class="pr-field-group">
            <label class="pr-field-label">3 Rep PR (lb)</label>
            <input class="pr-3rm-input" type="number" min="0" step="any" placeholder="e.g. 275">
          </div>
        </div>
        <div class="pr-edit-actions">
          <button class="pr-cancel-btn btn btn-ghost btn-sm">Cancel</button>
          <button class="pr-save-btn btn btn-primary btn-sm">Save PR</button>
        </div>`;

      card.querySelector(".pr-save-btn").addEventListener("click", () => {
        const newName = card.querySelector(".pr-name-input")?.value.trim() || "";
        const pr1 = card.querySelector(".pr-1rm-input").value.trim();
        const pr2 = card.querySelector(".pr-2rm-input").value.trim();
        const pr3 = card.querySelector(".pr-3rm-input").value.trim();
        if (!newName) { toast("Enter a lift name"); return; }
        // No values is fine — they fill themselves from logged workouts.
        c.coachPRs.push({ id: uid(), name: newName, pr1, pr2, pr3 });
        _prNewLifts = _prNewLifts.filter(nl => nl.tempId !== entry.id);
        saveTrainer();
        renderCoachPRs();
      });
      card.querySelector(".pr-cancel-btn").addEventListener("click", () => {
        _prNewLifts = _prNewLifts.filter(nl => nl.tempId !== entry.id);
        renderCoachPRs();
      });
    } else {
      // Existing lift: autosave card with per-PR value + mm/dd/yy date + lock
      // (same as the athlete side; coachPRs is the shared list).
      const slot = (n, label, ph) => {
        const lk = !!entry[`pr${n}Locked`];
        const ro = lk ? "readonly" : "";
        return `
          <div class="pr-field-group${lk ? " is-locked" : ""}">
            <label class="pr-field-label">${label}</label>
            <input class="pr-${n}rm-input" type="number" min="0" step="any" placeholder="${ph}" value="${escapeHtml(entry[`pr${n}`] || "")}" ${ro}>
            <input class="pr-${n}rm-date pr-date-input" type="text" inputmode="numeric" maxlength="8" placeholder="mm/dd/yy" title="Date achieved" value="${escapeHtml(entry[`pr${n}Date`] || "")}" ${ro}>
            <button class="pr-lock-btn${lk ? " is-locked" : ""}" data-slot="${n}" type="button" title="${lk ? "Locked. Tap to edit" : "Lock in"}" aria-label="${lk ? "Locked. Tap to edit" : "Lock in"}">${lk ? "🔒" : "🔓"}</button>
            ${prLoggedChip(entry, n, best)}
          </div>`;
      };
      card.innerHTML = `
        <div class="pr-view-header">
          <h4 class="pr-exercise-name">${escapeHtml(entry.name)}</h4>
          <button class="pr-delete-btn" title="Delete">×</button>
        </div>
        <div class="pr-edit-fields">
          ${slot(1, "1 Rep PR (lb)", "e.g. 315")}
          ${slot(2, "2 Rep PR (lb)", "e.g. 295")}
          ${slot(3, "3 Rep PR (lb)", "e.g. 275")}
        </div>
        ${athletePR ? `
          <div class="pr-athlete-row">
            <span class="pr-author athlete">athlete</span>
            <span>${prWeightLabel(entry.name, athletePR.weight)} × ${escapeHtml(athletePR.reps || "—")} reps</span>
          </div>` : ""}`;

      [1, 2, 3].forEach((n) => {
        card.querySelector(`.pr-${n}rm-input`).addEventListener("input", (e) => { entry[`pr${n}`] = e.target.value; saveTrainer(); });
        card.querySelector(`.pr-${n}rm-date`).addEventListener("input", (e) => {
          e.target.value = formatShortDate(e.target.value); // auto mm/dd/yy
          entry[`pr${n}Date`] = e.target.value;
          saveTrainer();
        });
      });
      card.querySelectorAll(".pr-lock-btn").forEach((btn) => {
        btn.addEventListener("click", () => {
          entry[`pr${btn.dataset.slot}Locked`] = !entry[`pr${btn.dataset.slot}Locked`];
          saveTrainer();
          renderCoachPRs();
        });
      });
      wirePRLoggedChips(card, entry, best, () => { saveTrainer(); renderCoachPRs(); });
      card.querySelector(".pr-delete-btn").addEventListener("click", () => {
        if (!window.confirm(`Delete "${entry.name}" PR?`)) return;
        c.coachPRs = c.coachPRs.filter(p => p.id !== entry.id);
        saveTrainer();
        renderCoachPRs();
      });
    }

    // Drag-and-drop reordering (existing entries only)
    if (!isNew) {
      card.setAttribute("draggable", "true");

      const handle = document.createElement("div");
      handle.className = "pr-drag-handle";
      handle.title = "Drag to reorder";
      card.insertBefore(handle, card.firstChild);

      card.addEventListener("dragstart", (e) => {
        _prDragSrcId = entry.id;
        e.dataTransfer.effectAllowed = "move";
        setTimeout(() => card.classList.add("pr-dragging"), 0);
      });
      card.addEventListener("dragend", () => {
        card.classList.remove("pr-dragging");
        $$("#coach-pr-container .pr-drag-over").forEach(el => el.classList.remove("pr-drag-over"));
      });
      card.addEventListener("dragover", (e) => {
        e.preventDefault();
        if (_prDragSrcId && _prDragSrcId !== entry.id) card.classList.add("pr-drag-over");
      });
      card.addEventListener("dragleave", (e) => {
        if (!card.contains(e.relatedTarget)) card.classList.remove("pr-drag-over");
      });
      card.addEventListener("drop", (e) => {
        e.preventDefault();
        card.classList.remove("pr-drag-over");
        if (!_prDragSrcId || _prDragSrcId === entry.id) return;
        const srcIdx = c.coachPRs.findIndex(p => p.id === _prDragSrcId);
        const tgtIdx = c.coachPRs.findIndex(p => p.id === entry.id);
        if (srcIdx === -1 || tgtIdx === -1) return;
        const [moved] = c.coachPRs.splice(srcIdx, 1);
        c.coachPRs.splice(tgtIdx, 0, moved);
        _prDragSrcId = null;
        saveTrainer();
        renderCoachPRs();
      });
    }

    return card;
  }

  // Format loose digits into mm/dd/yy as the athlete types (PR date fields).
  function formatShortDate(v) {
    const d = String(v).replace(/\D/g, "").slice(0, 6);
    if (d.length > 4) return `${d.slice(0, 2)}/${d.slice(2, 4)}/${d.slice(4)}`;
    if (d.length > 2) return `${d.slice(0, 2)}/${d.slice(2)}`;
    return d;
  }
  // Push the shared PR list to the athlete's cloud row (athlete-side writes).
  function pushAthleteCoachPRs() {
    const prog = state.clientData.program; if (!prog) return;
    saveClient();
    if (window.Cloud?.enabled && prog.clientId) {
      window.Cloud.debounce(`coachprs:${prog.clientId}`,
        () => window.Cloud.updateAthleteCoachPRs(prog.clientId, prog.client.coachPRs), 1200);
    }
  }

  // Athlete picks any lift to track — it becomes a shared 1/2/3-rep PR card
  // on both sides, and fills itself in from logged workouts.
  function openTrackLiftModal() {
    const prog = state.clientData.program; if (!prog) return;
    openModal({
      title: "Track a lift",
      body: `
        <p class="muted" style="margin-bottom:0.75em">Pick any exercise. Your 1, 2, and 3 rep bests fill in automatically as you log workouts, and you or your coach can type or lock values any time.</p>
        <label>Exercise
          <input type="text" id="track-lift-name" list="${prExerciseDatalist("athlete")}" placeholder="e.g. Back Squat" autocomplete="off" />
        </label>
        <p id="track-lift-error" class="error hidden"></p>`,
      actions: [
        { label: "Cancel", className: "btn btn-ghost", onClick: closeModal },
        { label: "Track it", className: "btn btn-primary", onClick: () => {
          const err = $("#track-lift-error");
          const name = $("#track-lift-name").value.trim();
          if (!name) { showErr(err, "Pick an exercise first."); return; }
          if (!prog.client.coachPRs) prog.client.coachPRs = [];
          if (prog.client.coachPRs.some((p) => exKey(p.name) === exKey(name))) {
            showErr(err, "You're already tracking that lift."); return;
          }
          prog.client.coachPRs.push({ id: uid(), name, pr1: "", pr2: "", pr3: "" });
          pushAthleteCoachPRs();
          closeModal();
          renderAthletePRs();
          toast(`Now tracking ${name} 🏆`);
        }},
      ],
    });
    setTimeout(() => $("#track-lift-name")?.focus(), 50);
  }

  function renderAthletePRs() {
    const container = $("#athlete-pr-container");
    const empty = $("#athlete-pr-empty");
    container.innerHTML = "";
    const prog = state.clientData.program; if (!prog) return;
    const athleteOwn = (state.clientData.progress.personalRecords || []).map((p) => ({ ...p, _author: "athlete" }));
    const coachPRs = (prog.client.coachPRs || []).filter(p => p.name);
    renderPRArchive($("#athlete-pr-archive"), state.clientData.progress.personalRecords || []);
    if (!athleteOwn.length && !coachPRs.length) show(empty); else hide(empty);

    // Shared 1RM/2RM/3RM cards — same list the coach sees; either side can fill them in.
    const pushCoachPRs = pushAthleteCoachPRs;
    const athleteLogs = state.clientData.progress?.exerciseLogs || {};
    let autoFilled = false;
    coachPRs.forEach(entry => {
      const best = bestLoggedByReps(entry.name, [...(prog.client.weeks || []), { days: prog.client.oneOffDays || [] }], athleteLogs);
      if (autoFillPRFromLogs(entry, best)) autoFilled = true;
      const card = document.createElement("div");
      card.className = "pr-edit-card pr-shared-card";
      // Each PR (1RM/2RM/3RM) has its own value + date + lock, so one can be
      // locked (read-only, can't be accidentally changed/cleared) on its own.
      const slot = (n, label, ph) => {
        const lk = !!entry[`pr${n}Locked`];
        const ro = lk ? "readonly" : "";
        return `
          <div class="pr-field-group${lk ? " is-locked" : ""}">
            <label class="pr-field-label">${label}</label>
            <input class="pr-${n}rm-input" type="number" min="0" step="any" placeholder="${ph}" value="${escapeHtml(entry[`pr${n}`] || "")}" ${ro}>
            <input class="pr-${n}rm-date pr-date-input" type="text" inputmode="numeric" maxlength="8" placeholder="mm/dd/yy" title="Date achieved" value="${escapeHtml(entry[`pr${n}Date`] || "")}" ${ro}>
            <button class="pr-lock-btn${lk ? " is-locked" : ""}" data-slot="${n}" type="button" title="${lk ? "Locked. Tap to edit" : "Lock in"}" aria-label="${lk ? "Locked. Tap to edit" : "Lock in"}">${lk ? "🔒" : "🔓"}</button>
            ${prLoggedChip(entry, n, best)}
          </div>`;
      };
      card.innerHTML = `
        <div class="pr-view-header">
          <h4 class="pr-exercise-name">${escapeHtml(entry.name)}</h4>
        </div>
        <div class="pr-edit-fields">
          ${slot(1, "1 Rep PR (lb)", "e.g. 315")}
          ${slot(2, "2 Rep PR (lb)", "e.g. 295")}
          ${slot(3, "3 Rep PR (lb)", "e.g. 275")}
        </div>`;
      [1, 2, 3].forEach((n) => {
        card.querySelector(`.pr-${n}rm-input`).addEventListener("input", (e) => { entry[`pr${n}`] = e.target.value; pushCoachPRs(); });
        card.querySelector(`.pr-${n}rm-date`).addEventListener("input", (e) => {
          e.target.value = formatShortDate(e.target.value); // auto mm/dd/yy
          entry[`pr${n}Date`] = e.target.value;
          pushCoachPRs();
        });
      });
      card.querySelectorAll(".pr-lock-btn").forEach((btn) => {
        btn.addEventListener("click", () => {
          const n = btn.dataset.slot;
          entry[`pr${n}Locked`] = !entry[`pr${n}Locked`];
          pushCoachPRs();
          renderAthletePRs();
        });
      });
      wirePRLoggedChips(card, entry, best, () => { pushCoachPRs(); renderAthletePRs(); });
      container.appendChild(card);
    });
    if (autoFilled) pushAthleteCoachPRs();

    // Track any lift from the library — the athlete's door into the shared list.
    const trackBtn = document.createElement("button");
    trackBtn.className = "btn btn-ghost pr-add-lift-btn";
    trackBtn.textContent = "＋ Track a lift";
    trackBtn.title = "Pick any exercise to track 1, 2, and 3 rep PRs for it";
    trackBtn.addEventListener("click", openTrackLiftModal);
    container.appendChild(trackBtn);

    // Athlete's own PRs (weight × reps format)
    if (athleteOwn.length) {
      groupPRs(athleteOwn).forEach((group) => container.appendChild(renderPRGroup(group)));
      container.querySelectorAll(".pr-delete").forEach((btn) => {
        btn.addEventListener("click", () => {
          if (!window.confirm("Delete this PR entry?")) return;
          state.clientData.progress.personalRecords =
            state.clientData.progress.personalRecords.filter((p) => p.id !== btn.dataset.id);
          saveClient();
          renderAthletePRs();
        });
      });
    }
  }

  function suggestExerciseNames(side) {
    // Return alphabetical, deduplicated names from the program's exercises
    let weeks = [];
    if (side === "coach") {
      const c = currentClient();
      weeks = c?.weeks || [];
    } else {
      weeks = state.clientData?.program?.client?.weeks || [];
    }
    const names = new Set();
    weeks.forEach((w) => w.days.forEach((d) => d.exercises.forEach((e) => {
      if (e.name) names.add(e.name.trim());
    })));
    return Array.from(names).sort();
  }

  function openAddPRModal(side) {
    openModal({
      title: "Add a PR",
      body: `
        <label>Exercise
          <input type="text" id="pr-name" list="${prExerciseDatalist(side)}" autocomplete="off" placeholder="e.g. Back Squat" autofocus />
        </label>
        <div class="grid-2">
          <label>Weight (lb)
            <input type="number" id="pr-weight" min="0" step="0.5" placeholder="lb" />
          </label>
          <label>Reps
            <input type="number" id="pr-reps" min="0" placeholder="reps" />
          </label>
        </div>
        <label>Date
          <input type="date" id="pr-date" />
        </label>
        <label>Notes (optional)
          <input type="text" id="pr-notes" placeholder="e.g. clean reps, no spotter" />
        </label>
        <p id="pr-error" class="error hidden"></p>`,
      actions: [
        { label: "Cancel", className: "btn btn-ghost", onClick: closeModal },
        { label: "Save PR", className: "btn btn-primary", onClick: () => {
            const err = $("#pr-error");
            const name = $("#pr-name").value.trim();
            const weight = $("#pr-weight").value.trim();
            const reps = $("#pr-reps").value.trim();
            const date = $("#pr-date").value || todayISO();
            const notes = $("#pr-notes").value.trim();
            if (!name) { showErr(err, "Exercise name is required."); return; }
            if (!weight && !reps) { showErr(err, "Enter at least a weight or reps."); return; }
            const pr = makePR({ name, weight, reps, date, notes });
            if (side === "coach") {
              const c = currentClient();
              if (!c.coachPRs) c.coachPRs = [];
              ensureSessionBank(c);
              c.coachPRs.push(pr);
              saveTrainer();
              closeModal();
              renderCoachPRs();
              const grp = $("#coach-pr-container .pr-exercise-group");
              if (grp) celebrateElement(grp);
            } else {
              if (!state.clientData.progress.personalRecords) state.clientData.progress.personalRecords = [];
              state.clientData.progress.personalRecords.push(pr);
              saveClient();
              closeModal();
              renderAthletePRs();
              const grp = $("#athlete-pr-container .pr-exercise-group");
              if (grp) celebrateElement(grp);
            }
            toast("PR saved 🏆");
          },
        },
      ],
    });
    setTimeout(() => {
      $("#pr-date").value = todayISO();
      $("#pr-name")?.focus();
    }, 50);
  }

  // -------- Session bank (athlete side) --------
  // ---- Athlete: open slots posted by the coach ----
  function athleteOpenSlots() {
    return Array.isArray(state.clientData.openSlots) ? state.clientData.openSlots : [];
  }
  async function refreshAthleteOpenSlots() {
    const client = state.clientData.program?.client;
    if (state.previewMode || client?.hideOpenSlots) {
      state.clientData.openSlots = [];
    } else if (window.Cloud?.enabled) {
      const slots = await window.Cloud.getOpenSlotsForAthlete();
      if (Array.isArray(slots)) state.clientData.openSlots = slots;
    }
    updateOpenSlotBadge();
    renderAthleteSessions();
  }
  function updateOpenSlotBadge() {
    const badge = $("#ctab-sessions-badge");
    if (!badge) return;
    const client = state.clientData.program?.client;
    const openCount = client?.hideOpenSlots ? 0 : athleteOpenSlots().filter((s) => s.status === "open" && !slotBookingClosed(s)).length;
    badge.textContent = openCount ? String(openCount) : "";
    badge.classList.toggle("hidden", !openCount);
  }
  async function claimAthleteSlot(id, btn) {
    if (state.previewMode) return;
    if (btn) { btn.disabled = true; btn.textContent = "Claiming…"; }
    const res = await window.Cloud.claimOpenSlot(id);
    if (res?.ok) toast("Slot claimed! Your coach will confirm. 🎉");
    else if (res?.reason === "taken") toast(`Just taken${res.claimedByName ? ` by ${res.claimedByName}` : ""}.`);
    else toast("Couldn't claim. Try again.");
    await refreshAthleteOpenSlots();
  }

  function renderAthleteSessions() {
    const container = $("#athlete-session-container"); if (!container) return;
    container.innerHTML = "";
    const prog = state.clientData.program;
    if (!prog?.client) return;
    ensureSessionBank(prog.client);
    renderClientHeaderSessions();
    if (!state.clientData.progress.packageRequests) state.clientData.progress.packageRequests = [];

    const sum = sessionBankSummary(prog.client);
    const pending = state.clientData.progress.packageRequests || [];

    const balance = document.createElement("div");
    balance.className = "card session-balance-card";
    balance.innerHTML = `
      <div class="session-balance">
        <div class="session-balance-num">${sum.remaining}</div>
        <div class="session-balance-label">sessions remaining</div>
      </div>
      <div class="session-balance-stats">
        <div><span class="session-stat-num">${sum.granted}</span><span class="session-stat-lbl">purchased</span></div>
        <div><span class="session-stat-num">${sum.used}</span><span class="session-stat-lbl">redeemed</span></div>
        <div><span class="session-stat-num">${pending.length}</span><span class="session-stat-lbl">requested</span></div>
      </div>`;
    // Balance card lives in the always-visible host above the calendar.
    const balHost = $("#athlete-balance-host");
    if (balHost) balHost.replaceChildren(balance); else container.appendChild(balance);

    // Membership card — coach-assigned plan (read-only), top of the Sessions tab.
    const membership = membershipById(prog.client.sessionBank?.membership);
    const memCard = document.createElement("div");
    memCard.className = "card membership-card";
    memCard.innerHTML = membership
      ? `<div class="membership-badge">🏅</div>
         <div class="membership-info">
           <div class="membership-label">Your membership</div>
           <div class="membership-title">${escapeHtml(membershipTitle(membership))}${membership.popular ? ` <span class="membership-pop">Most popular</span>` : ``}</div>
           <div class="membership-sub">${escapeHtml(membershipSub(membership))}</div>
         </div>`
      : `<div class="membership-badge">🏅</div>
         <div class="membership-info">
           <div class="membership-label">Your membership</div>
           <div class="membership-title muted">Not set yet</div>
           <div class="membership-sub muted">Your coach will set your plan.</div>
         </div>`;
    container.appendChild(memCard);

    // Open slots posted by the coach (skip entirely if this athlete is muted).
    if (!prog.client.hideOpenSlots) {
      const visible = athleteOpenSlots().filter((s) => s.status !== "closed");
      if (visible.length) {
        const myId = prog.client.id;
        const osCard = document.createElement("div");
        osCard.className = "card open-slots-athlete-card";
        osCard.innerHTML = `<h4 style="margin-top:0">📣 Open slots</h4>
          <p class="muted" style="font-size:0.85rem">Grab one first-come. Your coach confirms and books it.</p>`;
        [...visible].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)).forEach((s) => {
          const mine = s.status === "claimed" && s.claimedBy === myId;
          const taken = s.status === "claimed" && !mine;
          const closed = slotBookingClosed(s);
          let action;
          if (mine) action = `<span class="status-pill status-claimed">you claimed · pending</span>`;
          else if (taken) action = `<span class="status-pill status-cancelled">taken</span>`;
          else if (closed) action = `<span class="status-pill status-cancelled">booking closed</span>`;
          else action = `<button class="btn btn-primary btn-sm" data-claim="${escapeHtml(s.id)}">Claim it</button>`;
          const row = document.createElement("div");
          row.className = "open-slot-row";
          row.innerHTML = `
            <div class="open-slot-info">
              <strong>${escapeHtml(s.label || "Open slot")}</strong>
              ${s.note ? `<div class="muted" style="font-size:0.85rem">${escapeHtml(s.note)}</div>` : ""}
            </div>
            <div class="open-slot-actions">${action}</div>`;
          osCard.appendChild(row);
        });
        container.appendChild(osCard);
        osCard.querySelectorAll("[data-claim]").forEach((b) => b.addEventListener("click", () => claimAthleteSlot(b.dataset.claim, b)));
      }
    }

    // Gift sessions from the coach (already counted in the pool above; this
    // card just shows where the free sessions came from).
    const gifts = (prog.client.sessionBank.packages || []).filter((p) => p.gift && p.status === "paid");
    if (gifts.length) {
      const giftTotal = gifts.reduce((n, g) => n + (Number(g.size) || 0), 0);
      const giftCard = document.createElement("div");
      giftCard.className = "card gift-card";
      giftCard.innerHTML = `<h4 style="margin-top:0">🎁 Gift sessions from your coach</h4>
        <p class="muted" style="font-size:0.85rem">${giftTotal} free session${giftTotal === 1 ? "" : "s"} added to your balance.</p>`;
      [...gifts].sort((a, b) => (b.paidAt || 0) - (a.paidAt || 0)).forEach((g) => {
        const dateStr = g.paidAt ? new Date(g.paidAt).toLocaleDateString() : "";
        const row = document.createElement("div");
        row.className = "session-pkg-row";
        row.innerHTML = `<div><strong>🎁 ${escapeHtml(String(g.size))} session${g.size == 1 ? "" : "s"}</strong>${dateStr ? ` · <span class="muted">${escapeHtml(dateStr)}</span>` : ""}${g.note ? `<div class="muted" style="font-size:0.85rem">${escapeHtml(g.note)}</div>` : ""}</div>`;
        giftCard.appendChild(row);
      });
      container.appendChild(giftCard);
    }

    // (Buying is handled by the "+ Buy package" button at the top of the tab,
    // which opens the buy modal — no separate quick-buy card needed here.)

    // Pending requests (athlete side)
    if (pending.length) {
      const reqCard = document.createElement("div");
      reqCard.className = "card";
      reqCard.innerHTML = `<h4 style="margin-top:0">Your pending requests</h4>
        <p class="muted" style="font-size:0.85rem">Your coach has been notified. They'll add the sessions once payment is settled.</p>`;
      pending.forEach((req) => {
        const row = document.createElement("div");
        row.className = "pending-request-row";
        row.innerHTML = `
          <div><strong>${escapeHtml(String(req.size))} sessions${req.price ? ` · $${escapeHtml(Number(req.price).toLocaleString())}` : ""}</strong>
            <span class="muted"> · ${escapeHtml(req.requestedAt ? new Date(req.requestedAt).toLocaleDateString() : "")}</span></div>
          <button class="btn btn-ghost btn-sm" data-cancel-req="${escapeHtml(req.id)}">Cancel</button>`;
        reqCard.appendChild(row);
      });
      container.appendChild(reqCard);
      reqCard.querySelectorAll("[data-cancel-req]").forEach((btn) => {
        btn.addEventListener("click", () => {
          state.clientData.progress.packageRequests =
            state.clientData.progress.packageRequests.filter((r) => r.id !== btn.dataset.cancelReq);
          saveClient();
          renderAthleteSessions();
          toast("Request cancelled");
        });
      });
    }

    // Redemption history (read-only view of coach's record) — close-call
    // freebies are folded in so the athlete sees them alongside used sessions.
    const redemptions = prog.client.sessionBank.redemptions || [];
    const closeCalls = (prog.client.sessionBank.missedSessions || []).filter((m) => m.type === "closecall");
    const historyRows = [
      ...redemptions.map((r) => ({
        date: r.date || "",
        html: `<div><strong>${escapeHtml(r.date || "")}</strong>${r.note ? ` · <span class="muted">${escapeHtml(r.note)}</span>` : ""}</div>`,
      })),
      ...closeCalls.map((m) => ({
        date: m.date || "",
        html: `<div><strong>${escapeHtml(m.date || "")}</strong> · <span class="closecall-history">🤝 Close call: free missed session</span></div>`,
      })),
    ];
    const redCard = document.createElement("div");
    redCard.className = "card";
    redCard.innerHTML = `<h4 style="margin-top:0">Recent sessions</h4>`;
    if (!historyRows.length) {
      redCard.insertAdjacentHTML("beforeend", `<p class="muted">No sessions logged yet. Your coach marks each session after it happens.</p>`);
    } else {
      historyRows.sort((a, b) => b.date.localeCompare(a.date)).slice(0, 12).forEach((r) => {
        const row = document.createElement("div");
        row.className = "session-redeem-row";
        row.innerHTML = r.html;
        redCard.appendChild(row);
      });
    }
    container.appendChild(redCard);

    // Open-slot alert preference — athlete can mute it themselves. Always
    // shown (even when muted) so they can turn it back on.
    const prefCard = document.createElement("div");
    prefCard.className = "card open-slot-pref";
    const prefRow = document.createElement("label");
    prefRow.className = "open-slot-pref-row";
    const toggle = document.createElement("input");
    toggle.type = "checkbox";
    toggle.checked = !prog.client.hideOpenSlots;
    const txt = document.createElement("span");
    txt.textContent = "🔔 Notify me about open slots";
    toggle.addEventListener("change", () => {
      if (state.previewMode) { toggle.checked = !prog.client.hideOpenSlots; return; }
      prog.client.hideOpenSlots = !toggle.checked;
      saveClient();
      if (window.Cloud?.enabled) window.Cloud.updateAthleteHideOpenSlots(prog.client.id, prog.client.hideOpenSlots);
      refreshAthleteOpenSlots();
      toast(toggle.checked ? "Open-slot alerts on" : "Open-slot alerts off");
    });
    prefRow.appendChild(toggle);
    prefRow.appendChild(txt);
    prefCard.appendChild(prefRow);
    container.appendChild(prefCard);

    // Auto-expand the collapsible when there's something to act on: an open
    // slot to claim or a pending purchase request. Never force it closed, so
    // the athlete's own toggle is respected the rest of the time.
    const det = $("#athlete-session-details");
    if (det && (pending.length || (!prog.client.hideOpenSlots && athleteOpenSlots().some((s) => s.status !== "closed")))) det.open = true;

    if (typeof renderAthleteOverview === "function") renderAthleteOverview(); // keep the Overview session count fresh
  }

  // (Athlete-initiated package purchases are gone — packages now arrive via
  // the coach's monthly auto-renew, sized from booked sessions. The pending-
  // request rendering below stays so any old requests can drain out.)

  // -------- Day color system --------
  const DAY_COLORS = [
    { color: "#06b6d4", soft: "rgba(6,182,212,0.15)"   }, // teal
    { color: "#f97316", soft: "rgba(249,115,22,0.15)"   }, // orange
    { color: "#a855f7", soft: "rgba(168,85,247,0.15)"   }, // purple
    { color: "#ec4899", soft: "rgba(236,72,153,0.15)"   }, // rose
    { color: "#22c55e", soft: "rgba(34,197,94,0.15)"    }, // green
    { color: "#eab308", soft: "rgba(234,179,8,0.15)"    }, // yellow
    { color: "#6366f1", soft: "rgba(99,102,241,0.15)"   }, // indigo
  ];
  function getDayColor(idx) { return DAY_COLORS[idx % DAY_COLORS.length]; }
  function getDayIdx(client, weekId, dayId) {
    const week = (client.weeks || []).find(w => w.id === weekId);
    if (!week) return 0;
    const i = week.days.findIndex(d => d.id === dayId);
    return i >= 0 ? i : 0;
  }
  // Short "W1 D1" label for a program day — used on the athlete calendar so
  // completed/planned pills read as a program position, not just a day name.
  function weekDayLabel(client, weekId, dayId) {
    const wIdx = (client.weeks || []).findIndex((w) => w.id === weekId);
    const dIdx = getDayIdx(client, weekId, dayId);
    return `W${wIdx >= 0 ? wIdx + 1 : "?"} D${dIdx + 1}`;
  }

  // -------- Session history export (CSV — opens directly in Excel) --------
  function csvCell(v) {
    const s = String(v == null ? "" : v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  }
  function downloadFile(filename, content, mime) {
    const blob = new Blob([content], { type: mime || "text/plain" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  // One chronological ledger: every package purchase (+N) and every session
  // used (−1), with a running balance. Pending packages are listed but don't
  // count toward the balance until marked paid.
  function exportSessionHistory(client) {
    ensureSessionBank(client);
    const sum = sessionBankSummary(client);
    const events = [];
    client.sessionBank.packages.forEach((p) => {
      const pending = p.status === "pending";
      events.push({
        date: dateISO(new Date(p.paidAt || p.addedAt || Date.now())),
        type: pending ? "Package (pending payment)" : "Package purchased",
        delta: Number(p.size) || 0,
        note: p.note || "",
        counted: !pending,
        // Same-day tie-break: purchases land before redemptions so the
        // running balance never dips artificially negative.
        order: 0,
      });
    });
    client.sessionBank.redemptions.forEach((r) => {
      events.push({ date: r.date || "", type: "Session used", delta: -1, note: r.note || "", counted: true, order: 1 });
    });
    events.sort((a, b) => a.date.localeCompare(b.date) || a.order - b.order);
    let balance = 0;
    const rows = [
      ["Session history for", client.name || ""],
      ["Exported", todayISO()],
      ["Sessions purchased", sum.granted],
      ["Sessions used", sum.used],
      ["Sessions remaining", sum.remaining],
      [],
      ["Date", "Type", "Sessions", "Note", "Balance"],
    ];
    events.forEach((ev) => {
      if (ev.counted) balance += ev.delta;
      rows.push([
        ev.date,
        ev.type,
        ev.counted ? (ev.delta > 0 ? `+${ev.delta}` : ev.delta) : `(${ev.delta})`,
        ev.note,
        ev.counted ? balance : "",
      ]);
    });
    // BOM so Excel reads the file as UTF-8 (notes can contain any characters)
    const csv = "\uFEFF" + rows.map((r) => r.map(csvCell).join(",")).join("\r\n");
    const safeName = (client.name || "athlete").trim().replace(/[^\w-]+/g, "_") || "athlete";
    downloadFile(`${safeName}_sessions_${todayISO()}.csv`, csv, "text/csv;charset=utf-8");
    toast("Session history downloaded ✓");
  }

  // -------- Session bank (coach side) --------
  // Membership tiers from stonedragonstrengthtraining.com/memberships (pre-pay
  // monthly pricing). Coach assigns one per athlete in the Profile tab; athlete
  // sees it read-only on their Sessions tab. Stored as `client.sessionBank.membership`
  // (the id) — rides the coach-write-only session_bank jsonb, no DB migration.
  const MEMBERSHIPS = [
    { id: "single-1", cat: "Single Sessions",  perWeek: 1, sessions: 4,  price: 400  },
    { id: "single-2", cat: "Single Sessions",  perWeek: 2, sessions: 8,  price: 725, popular: true },
    { id: "single-3", cat: "Single Sessions",  perWeek: 3, sessions: 12, price: 1020 },
    { id: "single-4", cat: "Single Sessions",  perWeek: 4, sessions: 16, price: 1320 },
    { id: "couples-1", cat: "Couples Sessions", perWeek: 1, sessions: 4,  price: 550  },
    { id: "couples-2", cat: "Couples Sessions", perWeek: 2, sessions: 8,  price: 1040 },
    { id: "couples-3", cat: "Couples Sessions", perWeek: 3, sessions: 12, price: 1500 },
    // Standalone monthly tiers for client categorization. No perWeek/price
    // framing, so they carry their own title/sub/option labels.
    { id: "monthly-2",  cat: "Monthly Memberships", sessions: 2, title: "2 Session Monthly Membership", short: "2 sessions / month", optLabel: "2 sessions / month" },
    { id: "no-session", cat: "Monthly Memberships", sessions: 0, title: "No Session Membership",       short: "Program only · no sessions", optLabel: "No sessions (program only)" },
  ];
  function membershipById(id) { return MEMBERSHIPS.find((m) => m.id === id) || null; }
  function membershipTitle(m) { return m.title || `${m.cat} · ${m.perWeek}× / week`; }
  function membershipSub(m) {
    if (m.short) return m.short;
    const base = `${m.sessions} sessions / month`;
    return m.price ? `${base} · $${m.price.toLocaleString()}/mo` : base;
  }

  function renderCoachSessions() {
    const c = currentClient(); if (!c) return;
    ensureSessionBank(c);
    const container = $("#session-bank-container"); if (!container) return;
    container.innerHTML = "";

    const sum = sessionBankSummary(c);
    const importedRequests = c.importedProgress?.packageRequests || [];

    // Balance card
    const balance = document.createElement("div");
    balance.className = "card session-balance-card";
    balance.innerHTML = `
      <div class="session-balance">
        <div class="session-balance-num">${sum.remaining}</div>
        <div class="session-balance-label">sessions remaining</div>
      </div>
      <div class="session-balance-stats">
        <div><span class="session-stat-num">${sum.granted}</span><span class="session-stat-lbl">purchased</span></div>
        <div><span class="session-stat-num">${sum.used}</span><span class="session-stat-lbl">redeemed</span></div>
        <div><span class="session-stat-num">${sum.pendingCount}</span><span class="session-stat-lbl">pending</span></div>
      </div>`;
    // Balance card lives in the always-visible host above the calendar; the
    // rest of the ledger renders into the collapsible container below.
    const balHost = $("#session-balance-host");
    if (balHost) balHost.replaceChildren(balance); else container.appendChild(balance);

    // Partner link (couples): one shared bank between two athletes.
    const partner = partnerOf(c);
    const linkCard = document.createElement("div");
    linkCard.className = "card partner-link-card";
    if (partner) {
      linkCard.innerHTML = `
        <div class="partner-link-row">
          <div>
            <strong>💞 Shares sessions with ${escapeHtml(partner.name || "(unnamed)")}</strong>
            <div class="muted partner-link-note">One bank for the couple: packages, redemptions, and the monthly close call apply to both. Their shared booking spends one session.</div>
          </div>
          <button class="btn btn-ghost btn-sm" id="btn-unlink-partner" type="button">Unlink</button>
        </div>`;
      linkCard.querySelector("#btn-unlink-partner").addEventListener("click", () => unlinkPartner(c));
      container.appendChild(linkCard);
    } else if ((state.trainerData.clients || []).some((x) => x.id !== c.id && !x.partnerId)) {
      linkCard.innerHTML = `
        <div class="partner-link-row">
          <div>
            <strong>💞 Training as a couple?</strong>
            <div class="muted partner-link-note">Link a partner to share one session bank. One person pays, both spend from it. Programs stay separate.</div>
          </div>
          <button class="btn btn-ghost btn-sm" id="btn-link-partner" type="button">Link partner…</button>
        </div>`;
      linkCard.querySelector("#btn-link-partner").addEventListener("click", () => openLinkPartnerModal(c));
      container.appendChild(linkCard);
    }

    // Pending athlete requests (from imported progress)
    if (importedRequests.length) {
      const reqCard = document.createElement("div");
      reqCard.className = "card";
      reqCard.innerHTML = `<h4 style="margin-top:0">Athlete purchase requests</h4>
        <p class="muted" style="font-size:0.85rem">Confirm payment outside the app (Venmo / cash / Stripe link), then tap Approve to grant the sessions.</p>`;
      importedRequests.forEach((req) => {
        // Skip if already approved (matched by request id in packages)
        if (c.sessionBank.packages.some((p) => p.requestId === req.id)) return;
        const row = document.createElement("div");
        row.className = "pending-request-row";
        row.innerHTML = `
          <div>
            <strong>${escapeHtml(String(req.size))} sessions${req.price ? ` · $${escapeHtml(Number(req.price).toLocaleString())}` : ""}</strong>
            <span class="muted"> · requested ${escapeHtml(req.requestedAt ? new Date(req.requestedAt).toLocaleDateString() : "")}</span>
            ${req.note ? `<div class="muted" style="font-size:0.85rem">${escapeHtml(req.note)}</div>` : ""}
          </div>
          <div class="pending-request-actions">
            <button class="btn btn-ghost btn-sm" data-decline="${escapeHtml(req.id)}">Decline</button>
            <button class="btn btn-primary btn-sm" data-approve="${escapeHtml(req.id)}" data-size="${escapeHtml(String(req.size))}" data-price="${escapeHtml(String(req.price || ""))}">Approve &amp; mark paid</button>
          </div>`;
        reqCard.appendChild(row);
      });
      // Only show card if there were unapproved requests rendered
      if (reqCard.querySelector(".pending-request-row")) {
        container.appendChild(reqCard);
        // Surface pending requests by auto-expanding the collapsible.
        const det = $("#coach-session-details"); if (det) det.open = true;
        reqCard.querySelectorAll("[data-approve]").forEach((btn) => {
          btn.addEventListener("click", () => approvePackageRequest(c, btn.dataset.approve, Number(btn.dataset.size), Number(btn.dataset.price) || 0));
        });
        reqCard.querySelectorAll("[data-decline]").forEach((btn) => {
          btn.addEventListener("click", () => declinePackageRequest(c, btn.dataset.decline));
        });
      }
    }

    // Package history
    const pkgCard = document.createElement("div");
    pkgCard.className = "card";
    pkgCard.innerHTML = `<h4 style="margin-top:0">Packages</h4>`;
    if (!c.sessionBank.packages.length) {
      pkgCard.insertAdjacentHTML("beforeend", `<p class="muted">No packages yet. Tap <strong>+ Add package</strong> when you've collected payment.</p>`);
    } else {
      const sorted = [...c.sessionBank.packages].sort((a, b) => (b.paidAt || b.addedAt || 0) - (a.paidAt || a.addedAt || 0));
      sorted.forEach((pkg) => {
        const dateStr = pkg.paidAt ? new Date(pkg.paidAt).toLocaleDateString() : "—";
        const row = document.createElement("div");
        row.className = "session-pkg-row";
        const label = pkg.gift
          ? `🎁 ${escapeHtml(String(pkg.size))}-session gift`
          : `${escapeHtml(String(pkg.size))}-session package`;
        const pill = pkg.gift
          ? `<span class="status-pill status-gift">gift</span>`
          : `<span class="status-pill status-${escapeHtml(pkg.status || "paid")}">${escapeHtml(pkg.status || "paid")}</span>`;
        row.innerHTML = `
          <div>
            <strong>${label}</strong>
            <span class="muted"> · ${escapeHtml(dateStr)}</span>
            ${pkg.note ? `<div class="muted" style="font-size:0.85rem">${escapeHtml(pkg.note)}</div>` : ""}
          </div>
          <div class="session-pkg-row-right">
            ${pill}
            <button class="btn-delete-mini" data-del="${escapeHtml(pkg.id)}" title="Remove">×</button>
          </div>`;
        pkgCard.appendChild(row);
      });
    }
    container.appendChild(pkgCard);
    pkgCard.querySelectorAll("[data-del]").forEach((btn) => {
      btn.addEventListener("click", () => {
        if (!window.confirm("Remove this package? Redemptions are kept.")) return;
        c.sessionBank.packages = c.sessionBank.packages.filter((p) => p.id !== btn.dataset.del);
        bankMutated(c);
        saveTrainer(); renderCoachSessions();
      });
    });

    // Redemption history
    const redCard = document.createElement("div");
    redCard.className = "card";
    redCard.innerHTML = `<h4 style="margin-top:0">Redemption history</h4>`;
    if (!c.sessionBank.redemptions.length) {
      redCard.insertAdjacentHTML("beforeend", `<p class="muted">No redemptions yet. Tap <strong>− Redeem session</strong> after each completed session.</p>`);
    } else {
      const sorted = [...c.sessionBank.redemptions].sort((a, b) => (b.date || "").localeCompare(a.date || ""));
      sorted.forEach((r) => {
        const row = document.createElement("div");
        row.className = "session-redeem-row";
        row.innerHTML = `
          <div><strong>${escapeHtml(r.date || "")}</strong>${r.note ? ` · <span class="muted">${escapeHtml(r.note)}</span>` : ""}</div>
          <button class="btn-delete-mini" data-del="${escapeHtml(r.id)}" title="Undo">×</button>`;
        redCard.appendChild(row);
      });
    }
    container.appendChild(redCard);
    redCard.querySelectorAll("[data-del]").forEach((btn) => {
      btn.addEventListener("click", () => {
        if (!window.confirm("Undo this redemption?")) return;
        c.sessionBank.redemptions = c.sessionBank.redemptions.filter((r) => r.id !== btn.dataset.del);
        bankMutated(c);
        saveTrainer(); renderCoachSessions(); renderCoachCalendar();
      });
    });
  }

  function openAddPackageModal() {
    const c = currentClient(); if (!c) return;
    openModal({
      title: "Add training package",
      body: `
        <p class="muted" style="margin-top:-0.4em">Confirm payment with the athlete first (Venmo, cash, Stripe link, etc.), then add the package here.</p>
        <label>Number of sessions
          <input type="number" id="pkg-size-input" min="1" max="50" placeholder="e.g. 10" style="font-size:1.5rem;text-align:center;" autofocus />
        </label>
        <label>Note (optional)
          <input type="text" id="pkg-note" placeholder="e.g. Venmo $200 · ref #1234" />
        </label>`,
      actions: [
        { label: "Cancel", className: "btn btn-ghost", onClick: closeModal },
        { label: "Add package", className: "btn btn-primary", onClick: () => {
          const size = parseInt($("#pkg-size-input").value, 10);
          if (!size || size < 1 || size > 50) { toast("Enter a number between 1 and 50"); return; }
          const note = $("#pkg-note").value.trim();
          const pkg = { id: uid(), size, status: "paid", addedAt: Date.now(), paidAt: Date.now(), note };
          ensureSessionBank(c);
          c.sessionBank.packages.push(pkg);
          bankMutated(c);
          saveTrainer();
          renderCoachSessions();
          closeModal();
          toast(`Added ${size}-session package ✓`);
        }},
      ],
    });
  }

  // ---- Open Slots (coach broadcasts appointment openings; athletes claim) ----
  function ensureOpenSlots() {
    if (!Array.isArray(state.trainerData.openSlots)) state.trainerData.openSlots = [];
    return state.trainerData.openSlots;
  }
  const OPEN_SLOT_CUTOFFS = [0, 4, 8, 12, 16]; // hours before start; 0 = no cutoff

  // Booking is closed once we're within `cutoffHours` of the slot's start time.
  function slotBookingClosed(s) {
    if (!s.startAt || !s.cutoffHours) return false;
    const start = new Date(s.startAt).getTime();
    if (isNaN(start)) return false;
    return Date.now() >= start - s.cutoffHours * 3600 * 1000;
  }
  function formatSlotLabel(iso) {
    const d = new Date(iso);
    if (isNaN(d.getTime())) return "";
    return d.toLocaleString(undefined, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  }

  // Pull the authoritative list from cloud (which includes athlete claims)
  // before rendering, so the coach sees who claimed what.
  async function refreshCoachOpenSlots() {
    const coachId = state.trainerData.coachId;
    if (window.Cloud?.enabled && coachId) {
      const fresh = await window.Cloud.getCoachOpenSlots(coachId);
      if (Array.isArray(fresh)) { state.trainerData.openSlots = fresh; saveTrainer(); }
    }
    renderCoachOpenSlots();
  }

  // Apply a change on top of a fresh cloud copy so a coach edit never clobbers
  // an athlete claim that landed since the last render.
  async function mutateOpenSlots(fn) {
    const coachId = state.trainerData.coachId;
    if (window.Cloud?.enabled && coachId) {
      const fresh = await window.Cloud.getCoachOpenSlots(coachId);
      if (Array.isArray(fresh)) state.trainerData.openSlots = fresh;
    }
    state.trainerData.openSlots = fn(ensureOpenSlots());
    saveTrainer();
    renderCoachOpenSlots();
    if (window.Cloud?.enabled && coachId) window.Cloud.updateCoachOpenSlots(coachId, state.trainerData.openSlots);
  }

  function renderCoachOpenSlots() {
    const container = $("#open-slots-container"); if (!container) return;
    container.innerHTML = "";
    const slots = ensureOpenSlots();
    if (!slots.length) {
      container.insertAdjacentHTML("beforeend", `<p class="muted" style="font-size:0.85rem">No open slots posted. Tap <strong>+ Post open slot</strong> when you have an opening.</p>`);
    } else {
      [...slots].sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0)).forEach((s) => {
        const row = document.createElement("div");
        row.className = "open-slot-row";
        const closedByCutoff = s.status === "open" && slotBookingClosed(s);
        const statusHtml = s.status === "claimed"
          ? `<span class="status-pill status-claimed">claimed${s.claimedByName ? ` · ${escapeHtml(s.claimedByName)}` : ""}</span>`
          : s.status === "closed"
          ? `<span class="status-pill status-cancelled">closed</span>`
          : closedByCutoff
          ? `<span class="status-pill status-cancelled">booking closed</span>`
          : `<span class="status-pill status-open">open</span>`;
        const cutoffTxt = s.cutoffHours ? `🔒 closes ${s.cutoffHours}h before` : "";
        row.innerHTML = `
          <div class="open-slot-info">
            <strong>${escapeHtml(s.label || "Open slot")}</strong>
            ${s.note ? `<div class="muted" style="font-size:0.85rem">${escapeHtml(s.note)}</div>` : ""}
            ${cutoffTxt ? `<div class="muted" style="font-size:0.78rem">${cutoffTxt}</div>` : ""}
          </div>
          <div class="open-slot-actions">
            ${statusHtml}
            ${s.status === "claimed" ? `<button class="btn btn-ghost btn-xs" data-reopen="${escapeHtml(s.id)}">Reopen</button>` : ""}
            <button class="btn-delete-mini" data-del="${escapeHtml(s.id)}" title="Remove">×</button>
          </div>`;
        container.appendChild(row);
      });
      container.querySelectorAll("[data-del]").forEach((b) => b.addEventListener("click", () => {
        if (!window.confirm("Remove this open slot?")) return;
        mutateOpenSlots((arr) => arr.filter((s) => s.id !== b.dataset.del));
      }));
      container.querySelectorAll("[data-reopen]").forEach((b) => b.addEventListener("click", () => {
        mutateOpenSlots((arr) => arr.map((s) => s.id === b.dataset.reopen
          ? { ...s, status: "open", claimedBy: null, claimedByName: null, claimedAt: null } : s));
      }));
    }
    renderOpenSlotOptOut(container);
  }

  // Per-athlete opt-out so clients on a steady schedule can be muted.
  function renderOpenSlotOptOut(container) {
    const clients = state.trainerData.clients || [];
    if (!clients.length) return;
    const mutedCount = clients.filter((c) => c.hideOpenSlots).length;
    const details = document.createElement("details");
    details.className = "open-slot-optout";
    details.innerHTML = `<summary>🔕 Alert settings${mutedCount ? ` · ${mutedCount} muted` : ""}</summary>`;
    const list = document.createElement("div");
    list.className = "open-slot-optout-list";
    clients.slice().sort((a, b) => (a.name || "").localeCompare(b.name || "")).forEach((c) => {
      const item = document.createElement("label");
      item.className = "open-slot-optout-item";
      const cb = document.createElement("input");
      cb.type = "checkbox";
      cb.checked = !c.hideOpenSlots; // checked = receives alerts
      cb.addEventListener("change", () => {
        c.hideOpenSlots = !cb.checked;
        saveTrainer();
        if (window.Cloud?.enabled && state.trainerData.coachId) window.Cloud.upsertAthlete(c, state.trainerData.coachId);
      });
      const span = document.createElement("span");
      span.textContent = c.name || "Athlete";
      item.appendChild(cb); item.appendChild(span);
      list.appendChild(item);
    });
    details.appendChild(list);
    container.appendChild(details);
  }

  function openPostSlotModal() {
    const cutoffOpts = OPEN_SLOT_CUTOFFS.map((h) =>
      `<option value="${h}"${h === 8 ? " selected" : ""}>${h === 0 ? "No cutoff" : h + " hours before"}</option>`
    ).join("");
    openModal({
      title: "📣 Post an open slot",
      body: `
        <p class="muted" style="margin-top:-0.4em">Athletes see this and can claim it first-come. You confirm and book it in Setmore.</p>
        <div class="grid-2">
          <label>Date <input type="date" id="slot-date" value="${todayISO()}" /></label>
          <label>Time <input type="time" id="slot-time" /></label>
        </div>
        <label>Close booking
          <select id="slot-cutoff">${cutoffOpts}</select>
        </label>
        <label>Note (optional) <input type="text" id="slot-note" placeholder="e.g. 45-min session, upper body" /></label>`,
      actions: [
        { label: "Cancel", className: "btn btn-ghost", onClick: closeModal },
        { label: "Post slot 📣", className: "btn btn-primary", onClick: () => {
          const date = $("#slot-date").value;
          const time = $("#slot-time").value;
          if (!date || !time) { toast("Pick a date and time for the slot"); return; }
          const startAt = new Date(`${date}T${time}`).toISOString();
          if (isNaN(new Date(startAt).getTime())) { toast("That date/time didn't parse. Try again"); return; }
          const cutoffHours = parseInt($("#slot-cutoff").value, 10) || 0;
          const note = $("#slot-note").value.trim();
          const label = formatSlotLabel(startAt);
          mutateOpenSlots((arr) => [{ id: uid(), label, note, startAt, cutoffHours, status: "open", createdAt: Date.now() }, ...arr]);
          closeModal();
          toast("Open slot posted 📣");
        }},
      ],
    });
  }

  // Gift sessions: a package with status "paid" (so it counts in the available
  // pool via sessionBankSummary) plus gift:true / price:0 so both sides can
  // show it as a gift rather than a purchase.
  function openGiftSessionModal() {
    const c = currentClient(); if (!c) return;
    openModal({
      title: "🎁 Gift sessions",
      body: `
        <p class="muted" style="margin-top:-0.4em">Give free sessions to ${escapeHtml(c.name || "this athlete")}. They drop straight into the available pool and show as a gift on the athlete's side.</p>
        <label>Number of sessions
          <input type="number" id="gift-size-input" min="1" max="50" placeholder="e.g. 3" style="font-size:1.5rem;text-align:center;" autofocus />
        </label>
        <label>Message / note (optional)
          <input type="text" id="gift-note" placeholder="e.g. On the house, great work this month!" />
        </label>`,
      actions: [
        { label: "Cancel", className: "btn btn-ghost", onClick: closeModal },
        { label: "Gift sessions 🎁", className: "btn btn-primary", onClick: () => {
          const size = parseInt($("#gift-size-input").value, 10);
          if (!size || size < 1 || size > 50) { toast("Enter a number between 1 and 50"); return; }
          const note = $("#gift-note").value.trim();
          ensureSessionBank(c);
          c.sessionBank.packages.push({ id: uid(), size, status: "paid", gift: true, price: 0, addedAt: Date.now(), paidAt: Date.now(), note });
          bankMutated(c);
          saveTrainer();
          renderCoachSessions();
          closeModal();
          toast(`Gifted ${size} session${size === 1 ? "" : "s"} 🎁`);
        }},
      ],
    });
  }

  function openRedeemSessionModal() {
    const c = currentClient(); if (!c) return;
    ensureSessionBank(c);
    const sum = sessionBankSummary(c);
    if (sum.remaining <= 0) {
      if (!window.confirm("This athlete has no sessions remaining. Redeem anyway (creates a negative balance)?")) return;
    }
    openModal({
      title: "Redeem a session",
      body: `
        <p class="muted" style="margin-top:-0.4em">Counts one session against the athlete's balance. ${sum.remaining} remaining before this redemption.</p>
        <label>Date<input type="date" id="redeem-date" value="${todayISO()}" /></label>
        <label>Note (optional)<input type="text" id="redeem-note" placeholder="e.g. Heavy lower body session" /></label>`,
      actions: [
        { label: "Cancel", className: "btn btn-ghost", onClick: closeModal },
        { label: "Redeem", className: "btn btn-primary", onClick: () => {
            const date = $("#redeem-date").value || todayISO();
            const note = $("#redeem-note").value.trim();
            c.sessionBank.redemptions.push({ id: uid(), date, note });
            bankMutated(c);
            saveTrainer();
            renderCoachSessions();
            renderCoachCalendar();
            closeModal();
            toast("Session redeemed ✓");
          },
        },
      ],
    });
  }

  // c is passed explicitly — approvals can come from the athlete's Sessions
  // tab or the all-athletes Packages tracker, where no client is "open".
  function approvePackageRequest(c, reqId, size, price) {
    if (!c) return;
    ensureSessionBank(c);
    size = Math.min(50, Math.max(1, Number(size) || 1));
    c.sessionBank.packages.push({
      id: uid(), size, status: "paid",
      addedAt: Date.now(), paidAt: Date.now(),
      requestId: reqId,
      note: `Approved from athlete request${price ? ` · $${price.toLocaleString()}` : ""}`,
    });
    afterPackageRequestAction(c);
    toast(`Approved · ${size} sessions added`);
  }

  function declinePackageRequest(c, reqId) {
    if (!c) return;
    ensureSessionBank(c);
    // Mark as cancelled by adding a placeholder so it doesn't reappear after re-import.
    c.sessionBank.packages.push({
      id: uid(), size: 0, status: "cancelled",
      addedAt: Date.now(), requestId: reqId,
      note: "Athlete request declined",
    });
    afterPackageRequestAction(c);
    toast("Request declined");
  }

  // Persist + push the athlete (they may not be the open client) and refresh
  // whichever surfaces are showing package state.
  function afterPackageRequestAction(c) {
    bankMutated(c);
    localStorage.setItem(KEY_TRAINER, JSON.stringify(state.trainerData));
    if (window.Cloud?.enabled) {
      window.Cloud.debounce(`athlete:${c.id}`, () =>
        window.Cloud.upsertAthlete(c, state.trainerData.coachId)
      );
    }
    if (state.currentClientId === c.id) renderCoachSessions();
    // Keep the athlete-card 🎟 chips fresh if the Athletes list is showing.
    if (!$("#view-dashboard").classList.contains("hidden")) renderClientGrid();
    // Keep the Overview pending-requests inbox fresh if it's showing.
    if (!$("#view-overview").classList.contains("hidden")) renderOverviewRequests();
  }

  // Cross-athlete "pending purchase requests" inbox on the Overview page, so
  // new requests greet the coach at sign-in. Renders nothing when empty.
  function renderOverviewRequests() {
    const host = $("#overview-requests");
    if (!host) return;
    host.innerHTML = "";
    const open = [];
    (state.trainerData.clients || []).forEach((c) =>
      openRequestsFor(c).forEach((req) => open.push({ c, req })));
    if (!open.length) return;
    open.sort((a, b) => (b.req.requestedAt || 0) - (a.req.requestedAt || 0));

    const card = document.createElement("div");
    card.className = "card overview-requests-card";
    card.innerHTML = `<div class="program-head">
        <h3 style="margin:0">🎟 Purchase requests <span class="overview-req-count">${open.length}</span></h3>
      </div>
      <p class="muted" style="font-size:0.85rem">Confirm payment outside the app (Venmo, cash, Stripe link), then approve.</p>`;
    open.forEach(({ c, req }) => {
      const row = document.createElement("div");
      row.className = "pending-request-row";
      row.innerHTML = `
        <div>
          <strong>${escapeHtml(c.name)}</strong> · ${escapeHtml(String(req.size))} sessions${req.price ? ` · $${escapeHtml(Number(req.price).toLocaleString())}` : ""}
          <span class="muted"> · ${escapeHtml(req.requestedAt ? new Date(req.requestedAt).toLocaleDateString() : "")}</span>
        </div>
        <div class="pending-request-actions">
          <button class="btn btn-ghost btn-sm" data-decline="${escapeHtml(req.id)}">Decline</button>
          <button class="btn btn-primary btn-sm" data-approve="${escapeHtml(req.id)}">Approve &amp; mark paid</button>
        </div>`;
      row.querySelector("[data-approve]").addEventListener("click", () =>
        approvePackageRequest(c, req.id, Number(req.size), Number(req.price) || 0));
      row.querySelector("[data-decline]").addEventListener("click", () =>
        declinePackageRequest(c, req.id));
      card.appendChild(row);
    });
    host.appendChild(card);
  }

  // -------- "Since you were last here" activity feed (coach Overview) --------
  // dayCompletions only records a DATE (no clock time), so "new" can't be a
  // timestamp comparison. Instead each completion has a stable key —
  // clientId:dayId:date — and the coach's device remembers which keys it has
  // already shown, the same way the athlete side tracks seenMessages.
  const ACTIVITY_WINDOW_DAYS = 14;
  const ACTIVITY_MAX_ROWS = 8;

  function activityFeedItems() {
    const cutoff = addDaysISO(todayISO(), -ACTIVITY_WINDOW_DAYS);
    const out = [];
    (state.trainerData.clients || []).forEach((c) => {
      const dc = c.importedProgress?.dayCompletions || {};
      // dayId → day name, so a completion reads as "Push Day" not an opaque id.
      const dayNames = {};
      (c.weeks || []).forEach((w) => (w.days || []).forEach((d) => { dayNames[d.id] = d.name; }));
      Object.entries(dc).forEach(([dayId, dates]) => {
        (Array.isArray(dates) ? dates : []).forEach((date) => {
          if (!date || date < cutoff) return;
          out.push({
            key: `${c.id}:${dayId}:${date}`,
            clientId: c.id,
            dayId,
            name: c.name,
            // Days from an archived program are no longer in c.weeks.
            dayName: dayNames[dayId] || "a workout",
            date,
          });
        });
      });
    });
    out.sort((a, b) => b.date.localeCompare(a.date) || a.name.localeCompare(b.name));
    return out;
  }

  function saveSeenActivity() {
    localStorage.setItem(KEY_TRAINER, JSON.stringify(state.trainerData));
    // Sync the read marks so a dismissal here clears the card on the coach's
    // other devices too. Rides the library-prefs blob (see pushCoachLibPrefs).
    pushCoachLibPrefs();
  }

  // Prune keys that have aged out of the window so the map can't grow forever.
  // Prune by DATE, never by "is it in the list right now".
  //
  // This used to drop any seen key missing from the currently-loaded items,
  // which made already-read activity reappear: renderOverviewActivity runs at
  // coach entry BEFORE refreshAllAthletePackages has pulled each athlete's
  // importedProgress, so on that first pass the list is short, the prune wiped
  // those marks, and when the cloud data landed the same items rendered as new.
  // Keys are "<clientId>:<dayId>:<YYYY-MM-DD>" and uid() never emits a colon,
  // so the date is whatever follows the last one.
  function pruneSeenActivity(seen, cutoffISO) {
    let changed = false;
    Object.keys(seen).forEach((k) => {
      const date = k.slice(k.lastIndexOf(":") + 1);
      if (date < cutoffISO) { delete seen[k]; changed = true; }
    });
    return changed;
  }

  function markActivitySeen(items) {
    const seen = state.trainerData.seenActivity || (state.trainerData.seenActivity = {});
    items.forEach((it) => { seen[it.key] = true; });
    saveSeenActivity();
  }

  function activityWhen(date) {
    const days = Math.round((new Date(todayISO() + "T12:00:00") - new Date(date + "T12:00:00")) / 86400000);
    if (days <= 0) return "today";
    if (days === 1) return "yesterday";
    if (days < 7) return `${days} days ago`;
    return new Date(date + "T12:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" });
  }

  function renderOverviewActivity() {
    const host = $("#overview-activity");
    if (!host) return;
    host.innerHTML = "";
    const items = activityFeedItems();

    // First run on this device: adopt everything as already-seen so upgrading
    // doesn't greet the coach with two weeks of back-dated "new" activity.
    if (!state.trainerData.seenActivity) {
      state.trainerData.seenActivity = {};
      markActivitySeen(items);
      return;
    }
    const seen = state.trainerData.seenActivity;
    if (pruneSeenActivity(seen, addDaysISO(todayISO(), -ACTIVITY_WINDOW_DAYS))) saveSeenActivity();

    const fresh = items.filter((it) => !seen[it.key]);
    if (!fresh.length) return;

    const card = document.createElement("div");
    card.className = "card overview-activity-card";
    const shown = fresh.slice(0, ACTIVITY_MAX_ROWS);
    card.innerHTML = `<div class="program-head">
        <h3 style="margin:0">🏋️ New activity <span class="overview-req-count">${fresh.length}</span></h3>
        <button class="btn btn-ghost btn-sm" id="btn-activity-seen" type="button">Mark all read</button>
      </div>
      ${shown.map((it) => `<div class="activity-row" data-client="${escapeHtml(it.clientId)}" data-day="${escapeHtml(it.dayId)}" data-date="${escapeHtml(it.date)}">
        <span class="activity-name">${escapeHtml(it.name)}</span>
        <span class="activity-day">${escapeHtml(it.dayName)}</span>
        <span class="activity-when">${escapeHtml(activityWhen(it.date))}</span>
      </div>`).join("")}
      ${fresh.length > shown.length ? `<p class="muted activity-more">+${fresh.length - shown.length} more</p>` : ""}`;

    card.querySelectorAll(".activity-row").forEach((row) => {
      row.addEventListener("click", () =>
        openCompletedWorkout(row.dataset.client, row.dataset.day, row.dataset.date));
    });
    card.querySelector("#btn-activity-seen").addEventListener("click", () => {
      markActivitySeen(fresh);
      renderOverviewActivity();
    });
    host.appendChild(card);
  }

  // Tapping an activity row drops the coach straight into that athlete's live
  // session on the exact day they completed, with the completion date set so
  // the logged sets they entered show. If the day is gone (archived program),
  // fall back to opening the athlete's page — the workout no longer exists to
  // land on.
  function openCompletedWorkout(clientId, dayId, date) {
    const c = state.trainerData.clients.find((x) => x.id === clientId);
    if (!c) return renderDashboard();
    const week = (c.weeks || []).find((w) => (w.days || []).some((d) => d.id === dayId));
    if (!week) {
      openClient(clientId);
      toast("That workout was archived — opening their program instead", 3000);
      return;
    }
    state.currentClientId = clientId;
    Nav.push(exitPreview); // Back leaves the live session, same as the 🏋️ card button
    previewAsAthlete({ weekId: week.id, dayId, date });
  }

  // -------- Packages tracker (all athletes) --------
  // A request is open until a package row references its id (approve = paid
  // row, decline = cancelled placeholder).
  function openRequestsFor(c) {
    ensureSessionBank(c);
    return (c.importedProgress?.packageRequests || [])
      .filter((req) => !c.sessionBank.packages.some((p) => p.requestId === req.id));
  }

  // Pull fresh progress (which carries package requests) for every athlete,
  // then re-render. Also runs once in the background at coach entry so the
  // athlete-card session chips are current without visiting each athlete.
  let _packagesRefreshing = false;
  async function refreshAllAthletePackages() {
    if (!window.Cloud?.enabled || _packagesRefreshing) return;
    const clients = state.trainerData.clients || [];
    if (!clients.length) return;
    _packagesRefreshing = true;
    try {
      await Promise.all(clients.map(async (c) => {
        const progress = await window.Cloud.getProgress(c.id);
        if (progress) c.importedProgress = { ...progress, syncedAt: Date.now() };
      }));
      localStorage.setItem(KEY_TRAINER, JSON.stringify(state.trainerData));
    } catch (e) {
      console.warn("[Packages] refresh failed", e);
    } finally {
      _packagesRefreshing = false;
    }
    // Update the athlete-card chips / Overview inbox if either is on screen.
    // This pull is also what brings in fresh dayCompletions, so the activity
    // feed re-runs here — that's where "someone logged a workout" surfaces.
    if (!$("#view-dashboard").classList.contains("hidden")) renderClientGrid();
    if (!$("#view-overview").classList.contains("hidden")) {
      renderOverviewRequests();
      renderOverviewActivity();
    }
  }

  // ---- Coach → athlete announcements (Messages view) ---------------------
  const _msgSelected = new Set();

  function renderMessagesView() {
    const host = $("#msg-recipients");
    if (!host) return;
    const clients = [...(state.trainerData.clients || [])]
      .sort((a, b) => (a.name || "").localeCompare(b.name || ""));
    // Drop any selections for athletes that no longer exist.
    const ids = new Set(clients.map((c) => c.id));
    [..._msgSelected].forEach((id) => { if (!ids.has(id)) _msgSelected.delete(id); });

    if (!clients.length) {
      host.innerHTML = `<p class="muted" style="padding:0.4rem">Add an athlete first. Then you can message them here.</p>`;
    } else {
      host.innerHTML = clients.map((c) => {
        const on = _msgSelected.has(c.id);
        return `<button class="msg-recip${on ? " is-on" : ""}" type="button" data-cid="${escapeHtml(c.id)}" aria-pressed="${on}">
          <span class="msg-recip-check">${on ? "✓" : ""}</span>
          <span class="msg-recip-name">${escapeHtml(c.name || "Unnamed")}</span>
        </button>`;
      }).join("");
      host.querySelectorAll(".msg-recip").forEach((b) => {
        b.addEventListener("click", () => {
          const id = b.dataset.cid;
          if (_msgSelected.has(id)) _msgSelected.delete(id); else _msgSelected.add(id);
          renderMessagesView();
        });
      });
    }
    const cnt = $("#msg-recip-count");
    if (cnt) cnt.textContent = `${_msgSelected.size} selected`;
    renderMessageHistory();
  }

  function renderMessageHistory() {
    const host = $("#msg-history");
    if (!host) return;
    // Collect every message this coach has sent, de-duped by message id, newest first.
    const seen = new Map();
    (state.trainerData.clients || []).forEach((c) => {
      ensureSessionBank(c);
      (c.sessionBank.messages || []).forEach((m) => {
        const entry = seen.get(m.id) || { text: m.text, sentAt: m.sentAt, names: [] };
        entry.names.push(c.name || "Unnamed");
        seen.set(m.id, entry);
      });
    });
    const list = [...seen.values()].sort((a, b) => (b.sentAt || "").localeCompare(a.sentAt || ""));
    if (!list.length) {
      host.innerHTML = `<p class="muted" style="padding:0.4rem">No messages sent yet.</p>`;
      return;
    }
    host.innerHTML = list.slice(0, 25).map((m) => {
      const who = m.names.length > 3 ? `${m.names.length} athletes` : m.names.join(", ");
      return `<div class="msg-hist-item">
        <div class="msg-hist-text">${escapeHtml(m.text)}</div>
        <div class="msg-hist-meta">${escapeHtml(who)} · ${escapeHtml(msgWhen(m.sentAt))}</div>
      </div>`;
    }).join("");
  }

  function msgWhen(iso) {
    const d = iso ? new Date(iso) : null;
    if (!d || isNaN(d)) return "";
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) +
      ", " + d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  }

  function sendCoachMessage() {
    const ta = $("#msg-text");
    const statusEl = $("#msg-send-status");
    const text = (ta?.value || "").trim();
    if (!_msgSelected.size) { if (statusEl) statusEl.textContent = "Pick at least one athlete."; return; }
    if (!text) { if (statusEl) statusEl.textContent = "Write a message first."; return; }
    const msg = { id: uid(), text, sentAt: new Date().toISOString() };
    const recipients = (state.trainerData.clients || []).filter((c) => _msgSelected.has(c.id));
    recipients.forEach((c) => {
      ensureSessionBank(c);
      c.sessionBank.messages.push({ ...msg });
      // Keep the stored history bounded so the jsonb doesn't grow forever.
      if (c.sessionBank.messages.length > 50) c.sessionBank.messages = c.sessionBank.messages.slice(-50);
    });
    saveTrainer();
    // Push each recipient's row directly (saveTrainer only debounces the current athlete).
    if (window.Cloud?.enabled) {
      recipients.forEach((c) => window.Cloud.upsertAthlete(c, state.trainerData.coachId));
    }
    if (ta) ta.value = "";
    toast(`📣 Sent to ${recipients.length} athlete${recipients.length === 1 ? "" : "s"}`);
    if (statusEl) statusEl.textContent = "";
    renderMessagesView();
  }

  // ---- Coach bulletin board (shown to all athletes, self-expiring) --------
  // Stored on every athlete's sessionBank.bulletins; the coach's board is the
  // union of those (deduped by id), so it survives across the coach's devices.
  function activeCoachBulletins() {
    const now = Date.now();
    const seen = new Map();
    (state.trainerData.clients || []).forEach((c) => {
      ensureSessionBank(c);
      (c.sessionBank.bulletins || []).forEach((b) => {
        if (!b || (b.expiresAt && new Date(b.expiresAt).getTime() <= now)) return;
        if (!seen.has(b.id)) seen.set(b.id, b);
      });
    });
    return [...seen.values()].sort((a, b) => (b.postedAt || "").localeCompare(a.postedAt || ""));
  }

  function postBulletin() {
    const ta = $("#bulletin-text");
    const weeksSel = $("#bulletin-weeks");
    const statusEl = $("#bulletin-status");
    const text = (ta?.value || "").trim();
    if (!text) { if (statusEl) statusEl.textContent = "Write something first."; return; }
    const clients = state.trainerData.clients || [];
    if (!clients.length) { if (statusEl) statusEl.textContent = "Add an athlete first."; return; }
    const weeks = Math.min(4, Math.max(1, parseInt(weeksSel?.value, 10) || 1));
    const now = new Date();
    const expires = new Date(now.getTime() + weeks * 7 * 24 * 60 * 60 * 1000);
    const bulletin = { id: uid(), text, postedAt: now.toISOString(), expiresAt: expires.toISOString(), weeks };
    clients.forEach((c) => {
      ensureSessionBank(c);
      c.sessionBank.bulletins.push({ ...bulletin });
      pruneBulletins(c);
    });
    saveTrainer();
    if (window.Cloud?.enabled) {
      clients.forEach((c) => window.Cloud.upsertAthlete(c, state.trainerData.coachId));
      // Ping every athlete who's opted into notifications.
      window.Cloud.sendPush?.(clients.map((c) => c.id), "📌 New bulletin from your coach", text, "./");
    }
    if (ta) ta.value = "";
    if (statusEl) statusEl.textContent = "";
    toast("📌 Posted to all athletes");
    renderBulletinBoard();
  }

  function removeBulletin(id) {
    const clients = state.trainerData.clients || [];
    clients.forEach((c) => {
      ensureSessionBank(c);
      c.sessionBank.bulletins = c.sessionBank.bulletins.filter((b) => b.id !== id);
    });
    saveTrainer();
    if (window.Cloud?.enabled) clients.forEach((c) => window.Cloud.upsertAthlete(c, state.trainerData.coachId));
    renderBulletinBoard();
  }

  // Drop expired bulletins from an athlete's stored list.
  function pruneBulletins(c) {
    const now = Date.now();
    if (!c.sessionBank?.bulletins) return;
    c.sessionBank.bulletins = c.sessionBank.bulletins.filter(
      (b) => b && (!b.expiresAt || new Date(b.expiresAt).getTime() > now)
    );
  }

  function bulletinExpiryLabel(b) {
    const ms = new Date(b.expiresAt).getTime() - Date.now();
    if (ms <= 0) return "expired";
    const days = Math.ceil(ms / (24 * 60 * 60 * 1000));
    if (days >= 14) return `${Math.round(days / 7)} weeks left`;
    if (days > 1) return `${days} days left`;
    return "ends today";
  }

  function renderBulletinBoard() {
    const host = $("#bulletin-active");
    if (!host) return;
    const list = activeCoachBulletins();
    if (!list.length) {
      host.innerHTML = `<p class="muted" style="padding:0.5rem 0 0;font-size:0.85rem">No active notices.</p>`;
      return;
    }
    host.innerHTML = list.map((b) => `<div class="bulletin-item">
      <div class="bulletin-item-body">
        <div class="bulletin-item-text">${escapeHtml(b.text)}</div>
        <div class="bulletin-item-meta">${escapeHtml(bulletinExpiryLabel(b))}</div>
      </div>
      <button class="btn btn-ghost btn-sm bulletin-remove" type="button" data-bid="${escapeHtml(b.id)}">Remove</button>
    </div>`).join("");
    host.querySelectorAll(".bulletin-remove").forEach((btn) => {
      btn.addEventListener("click", () => removeBulletin(btn.dataset.bid));
    });
  }

  // -------- Athlete mode: invite-code login --------
  function loginWithInviteCode() {
    const raw = $("#invite-code-input").value;
    const code = normalizeInviteCode(raw);
    const err = $("#client-import-error");
    err.classList.add("hidden");
    if (code.length !== 8) {
      err.textContent = "Invite codes are 8 characters (like XXXX-XXXX).";
      err.classList.remove("hidden");
      return;
    }
    const formatted = code.slice(0, 4) + "-" + code.slice(4);

    // 1. Look for a matching client in trainer data on THIS browser
    const trainerData = loadJSON(KEY_TRAINER, DEFAULT_TRAINER);
    let match = trainerData.clients.find((c) => c.inviteCode === formatted);
    let trainerName = trainerData.trainer?.name || "";

    // 2. Look for a previously imported program with this invite code
    if (!match) {
      const cd = loadJSON(KEY_CLIENT, DEFAULT_CLIENT);
      if (cd.program?.client?.inviteCode === formatted) {
        // Resume existing imported program
        state.clientData = cd;
        ensureProgressShape(state.clientData.progress || (state.clientData.progress = emptyProgress()));
        if (state.clientData.profile) {
          playLoginFlash();
          enterClientPortal();
          toast("Welcome back");
        } else {
          showAthleteSetup();
        }
        return;
      }
    }

    if (!match) {
      // 3. Cloud lookup — works cross-device.
      if (window.Cloud?.enabled) {
        loginViaCloud(formatted, err);
        return;
      }
      err.textContent = "Code not recognized on this device. If you're on a new device, paste the long access code below.";
      err.classList.remove("hidden");
      return;
    }

    // Build a program payload from the matched client (live, no base64 needed for same-device)
    const program = {
      kind: "tp-program", v: 2,
      clientId: match.id,
      trainerName,
      sharedAt: Date.now(),
      client: {
        id: match.id, name: match.name, age: match.age, heightIn: match.heightIn, weightLb: match.weightLb,
        goals: match.goals, weeks: match.weeks, oneOffDays: match.oneOffDays || [], schedule: match.schedule || {},
        coachPRs: match.coachPRs || [], inviteCode: match.inviteCode,
        sessionBank: match.sessionBank || { packages: [], redemptions: [] },
        nutrition: match.nutrition || { current: null, history: [] },
      },
    };
    // Preserve progress if same client id has been loaded before
    const prev = state.clientData.program?.clientId === program.clientId ? state.clientData.progress : null;
    state.clientData.program = program;
    state.clientData.progress = prev || emptyProgress();
    ensureProgressShape(state.clientData.progress);
    saveClient();
    if (state.clientData.profile) {
      playLoginFlash();
      enterClientPortal();
      toast(`Loaded ${match.name}'s program`);
    } else {
      showAthleteSetup();
    }
  }

  // -------- Athlete mode: invite-code login via cloud --------
  async function loginViaCloud(formatted, err) {
    err.textContent = "Looking up code…";
    err.classList.remove("hidden");
    const athlete = await window.Cloud.getAthleteByInviteCode(formatted);
    if (!athlete) {
      err.textContent = "Code not recognized. Double-check with your coach, or paste a long access code below.";
      return;
    }
    const program = {
      kind: "tp-program", v: 2,
      clientId: athlete.id,
      trainerName: "",
      sharedAt: Date.now(),
      client: {
        id: athlete.id, name: athlete.name, age: athlete.age, heightIn: athlete.heightIn, weightLb: athlete.weightLb,
        goals: athlete.goals, weeks: athlete.weeks, oneOffDays: athlete.oneOffDays || [], schedule: athlete.schedule || {},
        coachPRs: athlete.coachPRs || [], inviteCode: athlete.inviteCode,
        sessionBank: athlete.sessionBank || { packages: [], redemptions: [] },
        nutrition: athlete.nutrition || { current: null, history: [] },
      },
    };
    const prev = state.clientData.program?.clientId === program.clientId ? state.clientData.progress : null;
    state.clientData.program = program;
    state.clientData.progress = prev || emptyProgress();
    ensureProgressShape(state.clientData.progress);
    // Only pull from cloud if this is a fresh device for this athlete.
    // Same-device returns: trust the local progress (avoid clobbering newer local writes).
    if (!prev) {
      // By invite code, not athlete id — this runs before the athlete has an
      // auth session, and RLS blocks direct progress reads for anon.
      const cloudProgress = await window.Cloud.getProgressByInviteCode(formatted);
      if (cloudProgress) {
        state.clientData.progress = cloudProgress;
        ensureProgressShape(state.clientData.progress);
      }
    }
    saveClient();
    err.classList.add("hidden");
    if (state.clientData.profile) {
      playLoginFlash();
      enterClientPortal();
      toast(`Loaded ${athlete.name}'s program from cloud`);
    } else {
      showAthleteSetup();
    }
  }

  // -------- Athlete mode: import program (long code) --------
  function importClientCode() {
    const err = $("#client-import-error");
    err.classList.add("hidden");
    try {
      const obj = decodeData($("#client-code").value);
      if (obj.kind !== "tp-program") throw new Error("This doesn't look like a Stone Dragon program code.");
      if (!obj.client || !obj.clientId) throw new Error("Code is missing client data.");
      const prev = state.clientData.program?.clientId === obj.clientId ? state.clientData.progress : null;
      // Ensure schedule field exists for v1 codes
      if (!obj.client.schedule) obj.client.schedule = {};
      state.clientData.program = obj;
      state.clientData.progress = prev || emptyProgress();
      saveClient();
      if (state.clientData.profile) {
        playLoginFlash();
        enterClientPortal();
        toast("Program loaded");
      } else {
        showAthleteSetup();
      }
    } catch (e) {
      err.textContent = "Couldn't load: " + (e.message || "invalid code");
      err.classList.remove("hidden");
    }
  }
  function emptyProgress() { return { exerciseLogs: {}, bodyweightLog: [], feedback: "", dayCompletions: {}, personalRecords: [], packageRequests: [], dayNotes: {}, dismissedBulletins: {}, seenMessages: {}, totalWorkoutMs: 0, workoutMoods: {}, addedExercises: {} }; }
  function ensureProgressShape(p) {
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
    return p;
  }

  // -------- Cardio log (athlete side) --------
  const CARDIO_TYPES = [
    ["🏃", "Run"], ["🚶", "Walk"], ["🚴", "Bike"], ["🚣", "Row"],
    ["🏊", "Swim"], ["🥾", "Hike"], ["🪜", "Stairs"], ["⚙️", "Elliptical"],
    ["🪢", "Jump rope"], ["⚽", "Sport"], ["⚡", "HIIT"], ["🔥", "Other"],
  ];
  const CARDIO_INTENSITIES = ["Low", "Moderate", "High"];
  const cardioIcon = (type) => (CARDIO_TYPES.find(([, n]) => n === type) || ["🔥"])[0];

  function renderAthleteCardio() {
    const container = $("#cardio-list-container");
    if (!container) return;
    container.innerHTML = "";
    ensureProgressShape(state.clientData.progress);
    const logs = [...state.clientData.progress.cardioLogs]
      .sort((a, b) => (b.date || "").localeCompare(a.date || ""));
    const card = document.createElement("div");
    card.className = "card";
    if (!logs.length) {
      card.innerHTML = `<p class="muted" style="margin:0.3em 0">Nothing logged yet. Tap <strong>+ Log cardio</strong> after your next session.</p>`;
    } else {
      logs.slice(0, 30).forEach((log) => {
        const row = document.createElement("div");
        row.className = "cardio-row";
        row.innerHTML = `
          <span class="cardio-row-icon">${cardioIcon(log.type)}</span>
          <div class="cardio-row-info">
            <strong>${escapeHtml(log.type || "Cardio")}</strong>
            <span class="muted">${escapeHtml(log.date || "")}${log.miles ? ` · ${escapeHtml(String(log.miles))} mi` : ""}</span>
          </div>
          <span class="cardio-min">${escapeHtml(String(log.minutes || 0))} min</span>
          <span class="cardio-intensity cardio-intensity-${escapeHtml((log.intensity || "moderate").toLowerCase())}">${escapeHtml(log.intensity || "Moderate")}</span>`;
        row.addEventListener("click", () => openCardioModal(log.id));
        card.appendChild(row);
      });
    }
    container.appendChild(card);
  }

  function openCardioModal(editId) {
    ensureProgressShape(state.clientData.progress);
    const logs = state.clientData.progress.cardioLogs;
    const existing = editId ? logs.find((l) => l.id === editId) : null;
    let type = existing?.type || "";
    let intensity = existing?.intensity || "Moderate";

    const typeGrid = CARDIO_TYPES.map(([icon, name]) => `
      <button class="cardio-type-btn${name === type ? " selected" : ""}" type="button" data-cardio-type="${escapeHtml(name)}">
        <span class="cardio-type-icon">${icon}</span><span class="cardio-type-name">${escapeHtml(name)}</span>
      </button>`).join("");
    const intensityChips = CARDIO_INTENSITIES.map((i) => `
      <button class="cardio-int-btn cardio-intensity-${i.toLowerCase()}${i === intensity ? " selected" : ""}" type="button" data-cardio-int="${i}">${i}</button>`).join("");

    const actions = [{ label: "Cancel", className: "btn btn-ghost", onClick: closeModal }];
    if (existing) {
      actions.push({ label: "Delete", className: "btn btn-ghost", onClick: () => {
        if (!window.confirm("Delete this cardio entry?")) return;
        state.clientData.progress.cardioLogs = logs.filter((l) => l.id !== editId);
        saveClient(); renderAthleteCardio(); closeModal(); toast("Deleted");
      }});
    }
    actions.push({ label: existing ? "Save changes" : "Save", className: "btn btn-primary", onClick: () => {
      const minutes = parseInt($("#cardio-minutes").value, 10);
      const date = $("#cardio-date").value || todayISO();
      const err = $("#cardio-error");
      if (!type) { showErr(err, "Pick a cardio type."); return; }
      if (!minutes || minutes < 1 || minutes > 600) { showErr(err, "Enter the minutes (1–600)."); return; }
      // Distance is optional — blank stays blank rather than becoming 0.
      const rawMiles = $("#cardio-miles").value.trim();
      const parsedMiles = rawMiles === "" ? null : parseFloat(rawMiles);
      if (parsedMiles !== null && (!isFinite(parsedMiles) || parsedMiles < 0 || parsedMiles > 200)) {
        showErr(err, "Distance must be between 0 and 200 miles."); return;
      }
      const miles = parsedMiles === null || parsedMiles === 0 ? "" : parsedMiles;
      if (existing) {
        Object.assign(existing, { type, minutes, intensity, date, miles });
      } else {
        logs.push({ id: uid(), type, minutes, intensity, date, miles });
      }
      saveClient();
      renderAthleteCardio();
      closeModal();
      toast(existing ? "Cardio updated ✓" : "Cardio logged ✓");
    }});

    openModal({
      title: existing ? "Edit cardio" : "Log cardio",
      body: `
        <div class="cardio-type-grid">${typeGrid}</div>
        <div class="cardio-int-row">${intensityChips}</div>
        <label>Time (minutes)
          <input type="number" id="cardio-minutes" min="1" max="600" placeholder="e.g. 30" value="${existing ? escapeHtml(String(existing.minutes)) : ""}" />
        </label>
        <label>Distance (miles) <span class="muted">— optional</span>
          <input type="number" id="cardio-miles" min="0" max="200" step="0.01" inputmode="decimal" placeholder="e.g. 3.1" value="${existing?.miles ? escapeHtml(String(existing.miles)) : ""}" />
        </label>
        <label>Date
          <input type="date" id="cardio-date" value="${escapeHtml(existing?.date || todayISO())}" />
        </label>
        <p id="cardio-error" class="error hidden"></p>`,
      actions,
    });
    $$("[data-cardio-type]").forEach((btn) => {
      btn.addEventListener("click", () => {
        type = btn.dataset.cardioType;
        $$("[data-cardio-type]").forEach((b) => b.classList.toggle("selected", b === btn));
      });
    });
    $$("[data-cardio-int]").forEach((btn) => {
      btn.addEventListener("click", () => {
        intensity = btn.dataset.cardioInt;
        $$("[data-cardio-int]").forEach((b) => b.classList.toggle("selected", b === btn));
      });
    });
  }
  function isDayChecked(dayId) {
    const dc = state.clientData?.progress?.dayCompletions;
    return !!(dc && dc[dayId] && dc[dayId].length > 0);
  }
  function toggleDayComplete(dayId) {
    ensureProgressShape(state.clientData.progress);
    const dc = state.clientData.progress.dayCompletions;
    if (isDayChecked(dayId)) dc[dayId] = [];
    else dc[dayId] = [todayISO()];
    saveClient();
    renderClientWorkouts();
  }
  // -------- Post-workout mood check-in ("How was your workout?") --------
  // Athlete taps up to 2 feelings when they finish a day; the picks show on
  // that day's card and feed the coach's per-day chips + program roll-up.
  const WORKOUT_MOODS = [
    { id: "energized",  emoji: "⚡", label: "Energized" },
    { id: "tired",      emoji: "🥱", label: "Tired" },
    { id: "strong",     emoji: "💪", label: "Strong" },
    { id: "weak",       emoji: "🫠", label: "Weak" },
    { id: "brutalized", emoji: "💥", label: "Brutalized" },
    { id: "wantmore",   emoji: "🔥", label: "Wanting more" },
    { id: "sick",       emoji: "🤢", label: "Sick" },
    { id: "dead",       emoji: "💀", label: "Dead" },
  ];
  const MAX_MOODS = 2;
  const moodById = (id) => WORKOUT_MOODS.find((m) => m.id === id) || null;
  // Latest mood pick list for a day, from any progress object (athlete-local or
  // the coach's mirrored importedProgress).
  function dayMoods(progress, dayId) {
    const rec = progress?.workoutMoods?.[dayId];
    return Array.isArray(rec?.moods) ? rec.moods : [];
  }
  // Small emoji-chip row for a day's moods; "" when none. `compact` drops labels.
  function moodChipsHtml(moods, compact) {
    const ids = (moods || []).map(moodById).filter(Boolean);
    if (!ids.length) return "";
    return `<span class="mood-chips${compact ? " compact" : ""}">${ids.map((m) =>
      `<span class="mood-chip" title="${escapeHtml(m.label)}"><span class="mood-emo">${m.emoji}</span>${compact ? "" : `<span class="mood-txt">${escapeHtml(m.label)}</span>`}</span>`).join("")}</span>`;
  }
  // Aggregate mood counts across a client's current program (+ one-off days),
  // newest-heaviest-first, for the coach roll-up. Returns [{ id, emoji, label, n }].
  function moodRollup(client, progress) {
    const p = progress || client?.importedProgress; if (!p?.workoutMoods) return [];
    const counts = {};
    const dayIds = new Set();
    (client?.weeks || []).forEach((w) => (w.days || []).forEach((d) => dayIds.add(d.id)));
    (client?.oneOffDays || []).forEach((d) => dayIds.add(d.id));
    Object.entries(p.workoutMoods).forEach(([dayId, rec]) => {
      if (dayIds.size && !dayIds.has(dayId)) return; // scope to current program
      (rec?.moods || []).forEach((id) => { counts[id] = (counts[id] || 0) + 1; });
    });
    return WORKOUT_MOODS.map((m) => ({ ...m, n: counts[m.id] || 0 }))
      .filter((m) => m.n > 0).sort((a, b) => b.n - a.n);
  }
  // Save (athlete-side) the mood picks for a day, latest-wins. Empty clears it.
  function setDayMoods(dayId, moods) {
    const p = state.clientData.progress; if (!p) return;
    ensureProgressShape(p);
    const clean = (moods || []).filter(moodById).slice(0, MAX_MOODS);
    if (!clean.length) delete p.workoutMoods[dayId];
    else p.workoutMoods[dayId] = { date: todayISO(), moods: clean };
    saveClient();
  }
  // The "How was your workout?" sheet. Athlete-only; up to 2 picks.
  function openWorkoutMoodSheet(day) {
    if (!day || state.mode !== "client") return;
    const p = state.clientData.progress; if (!p) return;
    let sel = dayMoods(p, day.id).slice();
    const draw = () => {
      const body = $("#modal-body"); if (!body) return;
      body.innerHTML = `
        <p class="mood-sheet-sub">Tap up to ${MAX_MOODS}.</p>
        <div class="mood-grid">
          ${WORKOUT_MOODS.map((m) => `<button type="button" class="mood-opt${sel.includes(m.id) ? " on" : ""}" data-mood="${m.id}">
              <span class="mood-opt-emo">${m.emoji}</span><span class="mood-opt-lbl">${escapeHtml(m.label)}</span>
            </button>`).join("")}
        </div>`;
      body.querySelectorAll("[data-mood]").forEach((btn) => btn.addEventListener("click", () => {
        const id = btn.dataset.mood;
        if (sel.includes(id)) sel = sel.filter((x) => x !== id);
        else if (sel.length < MAX_MOODS) sel.push(id);
        else { toast(`Pick up to ${MAX_MOODS}`); return; }
        draw();
      }));
    };
    const commit = () => { setDayMoods(day.id, sel); closeModal(); renderClientWorkouts(); renderAthleteCalendar(); };
    openModal({
      title: "How was your workout?",
      body: "",
      actions: [
        { label: "Clear", className: "btn btn-ghost", onClick: () => { sel = []; commit(); } },
        { label: "Save", className: "btn btn-primary", onClick: commit },
      ],
    });
    draw();
  }

  // Auto-marks a day complete on the calendar once every exercise in it is
  // locked in — the athlete shouldn't have to separately check it off.
  // "<dayId>:<date>" for days already celebrated this session — see below.
  const _celebratedDays = new Set();
  function autoSyncDayCompletion(day) {
    if (!day.exercises.length) return;
    // hasAnyLog only counts locked entries, so this is genuinely "every
    // exercise locked in", not "every exercise has a draft".
    const allDone = day.exercises.every((ex) => hasAnyLog(ex));
    if (allDone === isDayChecked(day.id)) return; // no transition — nothing to do
    ensureProgressShape(state.clientData.progress);
    state.clientData.progress.dayCompletions[day.id] = allDone ? [todayISO()] : [];
    saveClient();
    renderAthleteCalendar();
    // Once per day per date: the not-done → done edge alone isn't enough,
    // because correcting a number means unlock → relock, which crosses that
    // edge again and would fire a second burst. Session-scoped rather than
    // persisted — it's not worth a data-shape change and a cloud round trip
    // to suppress a repeat that only happens after a page reload.
    if (allDone) {
      const key = `${day.id}:${todayISO()}`;
      if (!_celebratedDays.has(key)) {
        _celebratedDays.add(key);
        celebrateDayComplete();
        // After the confetti, ask how it felt (once) — unless they already rated.
        if (!dayMoods(state.clientData.progress, day.id).length) {
          setTimeout(() => openWorkoutMoodSheet(day), 750);
        }
      }
    }
  }
  function findCompletedDayForDate(client, iso) {
    const dc = state.clientData.progress?.dayCompletions || {};
    for (const week of client.weeks) {
      for (const day of week.days) {
        if ((dc[day.id] || []).includes(iso)) return { week, day };
      }
    }
    for (const day of client.oneOffDays || []) {
      if ((dc[day.id] || []).includes(iso)) return { week: null, day, oneOff: true };
    }
    return null;
  }
  function resumeClient() {
    if (!state.clientData.program) return;
    if (!state.clientData.progress) state.clientData.progress = emptyProgress();
    if (!state.clientData.program.client.schedule) state.clientData.program.client.schedule = {};
    enterClientPortal();
  }
  function enterClientPortal() {
    // In preview we stay in coach mode so a reload restores the coach view.
    if (!state.previewMode) {
      state.mode = "client";
      sessionStorage.setItem(KEY_SESSION, "client");
    }
    // In coach preview keep the coach's theme (the athlete picker is disabled
    // there anyway); a real athlete session uses the athlete's saved theme.
    applyTheme(currentThemeForRole(state.previewMode ? "coach" : "athlete"));
    hide($("#screen-login"));
    hide($("#screen-app"));
    show($("#screen-client"));
    if (!state.clientData.progress) state.clientData.progress = emptyProgress();
    ensureProgressShape(state.clientData.progress);
    const prog = state.clientData.program;
    $("#client-portal-name").textContent = prog.client.name;
    renderClientHeaderSessions();
    // Profile tab: editable details, invite code, theme picker
    renderAthleteProfileFields();
    const pInvite = $("#profile-invite");
    if (pInvite) pInvite.innerHTML = prog.client.inviteCode
      ? `<span class="profile-invite-label">🔑 Invite code</span><span class="profile-invite-code">${escapeHtml(prog.client.inviteCode)}</span>`
      : "";
    renderThemePicker($("#athlete-theme-picker"), "athlete");
    setClientTab("overview"); // land on the Overview home
    const now = new Date();
    state.athleteCal = { year: now.getFullYear(), month: now.getMonth() };
    renderAthleteCalendar();
    renderClientWorkouts();
    renderClientDiet();
    renderClientProgress();
    renderAthleteCardio();
    renderAthletePRs();
    renderStrengthProgress($("#athlete-strength-charts"), prog.client, state.clientData.progress);
    renderAthleteSessions();
    renderAthleteOverview();
    refreshAthleteOpenSlots();
    renderAthleteNotifyCard();
    refreshPushSubscription();
    // First time on this device: one guided lap (never during a coach live
    // session — that's the coach's screen, not the athlete's).
    if (!state.previewMode && !localStorage.getItem(KEY_TOUR_ATHLETE)) {
      setTimeout(() => { if (!state.previewMode && state.mode === "client") beginAthleteTour(); }, 800);
    }
  }
  // -------- Athlete Overview (home dashboard) --------
  // Athlete-side read-only inbox for coach announcements (piggybacks
  // sessionBank.messages, which the coach writes). Shows newest first, and
  // remembers which the athlete has seen via a local set so nothing flashes
  // as "new" forever.
  function renderAthleteCoachMessages(c) {
    const bulletinHost = $("#ov-bulletin");
    const host = $("#ov-messages");
    const now = Date.now();

    // ---- Bulletin board: pinned at the very top, athlete-clearable ----
    // The coach's board mirrors onto every athlete's sessionBank.bulletins.
    // Clearing is athlete-local (dismissedBulletins on progress) so it never
    // deletes the coach's post or affects other athletes; new posts reappear.
    if (bulletinHost) {
      const dismissed = state.clientData.progress?.dismissedBulletins || {};
      const allBulletins = (c ? (c.sessionBank?.bulletins || []) : [])
        .filter((b) => b && (!b.expiresAt || new Date(b.expiresAt).getTime() > now));
      const bulletins = allBulletins
        .filter((b) => !dismissed[b.id])
        .sort((a, b) => (b.postedAt || "").localeCompare(a.postedAt || ""));
      // Prune dismissed ids for bulletins that no longer exist so the map can't grow forever.
      if (state.clientData.progress?.dismissedBulletins) {
        const live = new Set(allBulletins.map((b) => b.id));
        let pruned = false;
        Object.keys(dismissed).forEach((id) => { if (!live.has(id)) { delete dismissed[id]; pruned = true; } });
        if (pruned) saveClient();
      }
      if (!bulletins.length) {
        bulletinHost.innerHTML = "";
      } else {
        const bitems = bulletins.map((b) => `<div class="ovmsg-item">
          <div class="ovmsg-text">${escapeHtml(b.text)}</div>
        </div>`).join("");
        bulletinHost.innerHTML = `<div class="ovmsg-card ovmsg-bulletin">
          <div class="ovmsg-head"><span class="ovmsg-icon">📌</span><span>Bulletin board</span><button class="btn btn-ghost btn-sm ovmsg-clear" id="btn-clear-bulletins" type="button">Clear</button></div>
          ${bitems}
        </div>`;
        $("#btn-clear-bulletins")?.addEventListener("click", () => {
          if (!state.clientData.progress) state.clientData.progress = {};
          const d = state.clientData.progress.dismissedBulletins || (state.clientData.progress.dismissedBulletins = {});
          bulletins.forEach((b) => { d[b.id] = true; });
          saveClient();
          renderAthleteCoachMessages(c);
        });
      }
    }

    // ---- Targeted coach messages ----
    if (!host) return;
    const msgs = c ? [...(c.sessionBank?.messages || [])] : [];
    if (!msgs.length) { host.innerHTML = ""; return; }
    msgs.sort((a, b) => (b.sentAt || "").localeCompare(a.sentAt || ""));
    const seen = state.clientData.progress?.seenMessages || {};

    const items = msgs.slice(0, 8).map((m) => {
      const fresh = !seen[m.id];
      return `<div class="ovmsg-item${fresh ? " is-new" : ""}">
        <div class="ovmsg-text">${escapeHtml(m.text)}</div>
        <div class="ovmsg-meta">${fresh ? `<span class="ovmsg-new">New</span>` : ""}${escapeHtml(msgWhen(m.sentAt))}</div>
      </div>`;
    }).join("");
    host.innerHTML = `<div class="ovmsg-card">
      <div class="ovmsg-head"><span class="ovmsg-icon">📣</span><span>From your coach</span></div>
      ${items}
    </div>`;
    // Mark all currently-shown messages as seen (persist locally).
    if (!state.clientData.progress) state.clientData.progress = {};
    if (!state.clientData.progress.seenMessages) state.clientData.progress.seenMessages = {};
    const seenMap = state.clientData.progress.seenMessages;
    let changed = false;
    msgs.forEach((m) => { if (!seenMap[m.id]) { seenMap[m.id] = true; changed = true; } });
    // Prune ids no longer present so the map can't grow forever.
    const live = new Set(msgs.map((m) => m.id));
    Object.keys(seenMap).forEach((id) => { if (!live.has(id)) { delete seenMap[id]; changed = true; } });
    if (changed) saveClient();
  }

  // -------- Overview stats: fixed calendar-header tiles + customizable racing bar --------
  function ovStatTile({ icon, num, small, label, title, trend, trendNeutral }) {
    const arrow = trend === "up" ? "▲" : trend === "down" ? "▼" : "";
    const t = trend ? `<span class="cal-trend ${trend}${trendNeutral ? " neutral" : ""}">${arrow}</span>` : "";
    return `<span class="cal-stat" title="${escapeHtml(title || "")}">
        <span class="cal-stat-val"><span class="cal-stat-ico">${icon}</span><span class="cal-stat-num${small ? " cal-stat-sm" : ""}">${escapeHtml(String(num))}</span>${t}</span>
        <span class="cal-stat-lbl">${escapeHtml(label)}</span>
      </span>`;
  }
  function ovRingTile({ done, total, label, title }) {
    const CIRC = 2 * Math.PI * 16;
    const off = CIRC * (1 - (total ? (done / total) * 100 : 0) / 100);
    return `<span class="cal-stat cal-stat-ring" title="${escapeHtml(title || "")}">
        <span class="cal-ring-wrap"><svg viewBox="0 0 36 36" class="cal-ring" aria-hidden="true">
          <circle class="cal-ring-track" cx="18" cy="18" r="16"/>
          <circle class="cal-ring-fill" cx="18" cy="18" r="16" style="stroke-dasharray:${CIRC.toFixed(1)};stroke-dashoffset:${off.toFixed(1)}"/>
        </svg><span class="cal-ring-txt">${done}/${total}</span></span>
        <span class="cal-stat-lbl">${escapeHtml(label)}</span>
      </span>`;
  }
  // The calendar header keeps just the quick-glance tiles: week ring + streak
  // (+ next session when booked). The customizable set lives in the racing bar.
  function renderCalHeaderStats(ctx) {
    const host = $("#ccal-stats"); if (!host) return;
    const tiles = [];
    if (ctx.totalDays) tiles.push(ovRingTile({ done: ctx.doneDays, total: ctx.totalDays, label: "week",
      title: `${ctx.doneDays} of ${ctx.totalDays} workouts done in ${ctx.weekLabel}` }));
    tiles.push(ovStatTile({ icon: "🔥", num: ctx.streakN, label: "streak",
      title: "Consecutive weeks with at least one completed workout" }));
    if (ctx.bookingLabel) tiles.push(ovStatTile({ icon: "📅", num: ctx.bookingLabel, small: true, label: "next",
      title: "Your next booked session" }));
    host.innerHTML = tiles.join("");
  }

  // -------- Customizable "racing" stats bar (slanted rows in the stats card) --------
  // Each stat: { id, icon, label, get(ctx) -> { value, unit?, when?, trend?, trendNeutral? } | null }.
  function racingRowHtml(label, d) {
    const tr = d.trend ? `<span class="sr-trend ${d.trend}${d.trendNeutral ? " neutral" : ""}">${d.trend === "up" ? "▲" : "▼"}</span>` : "";
    return `<div class="ov-stat-row"><div class="sr-in"><span class="sr-lbl">${escapeHtml(label)}${d.when ? ` <span class="sr-when">${escapeHtml(d.when)}</span>` : ""}</span><span class="sr-val">${escapeHtml(String(d.value))}${d.unit ? `<span class="sr-unit">${escapeHtml(d.unit)}</span>` : ""}${tr}</span></div></div>`;
  }
  const RACING_LIB = [
    { id: "workouts", icon: "🏋️", label: "Workouts", get: (x) => ({ value: completionDateList(x.progress).length }) },
    { id: "prs", icon: "🥇", label: "PRs", get: (x) => ({ value: (x.progress.personalRecords || []).length }) },
    { id: "highestpr", icon: "🏅", label: "Highest PR", get: (x) => {
        const top = highestPR(x.c, x.progress); if (!top) return null;
        const db = isDumbbellLift(top.name);
        return { value: db ? `${top.weight}` : top.weight, unit: db ? "s" : "lb", when: top.name || undefined }; } },
    { id: "timetrained", icon: "⏳", label: "Time trained", get: (x) => {
        const ms = x.progress.totalWorkoutMs || 0; if (!ms) return null;
        return { value: formatWorkoutTime(ms) }; } },
    { id: "lastworkout", icon: "⏱️", label: "Last workout", get: (x) => x.lastWk ? ({ value: formatTonnage(x.lastWk.volume), unit: "lb", when: x.lastWkLabel }) : null },
    { id: "tonnage", icon: "🧮", label: "Total lifted", get: (x) => x.ton ? ({ value: formatTonnage(x.ton), unit: "lb" }) : null },
    { id: "volweek", icon: "📈", label: "Volume this week", get: (x) => {
        const b = volumeBuckets(x.progress, "week"); if (!b.length) return null;
        const cur = b[b.length - 1].v, prev = b.length > 1 ? b[b.length - 2].v : 0;
        const trend = prev ? (cur > prev ? "up" : cur < prev ? "down" : null) : null;
        return { value: formatTonnage(cur), unit: "lb", trend }; } },
    { id: "month", icon: "📆", label: "This month", get: (x) => {
        const ym = x.today.slice(0, 7);
        return { value: completionDateList(x.progress).filter((d) => d.slice(0, 7) === ym).length }; } },
    { id: "streak", icon: "🔥", label: "Week streak", get: (x) => ({ value: x.streakN }) },
    { id: "thisweek", icon: "◔", label: "This week", get: (x) => x.totalDays ? ({ value: `${x.doneDays}/${x.totalDays}` }) : null },
    { id: "bw", icon: "⚖️", label: "Bodyweight", get: (x) => {
        const log = [...(x.progress.bodyweightLog || [])].filter((e) => e.date && isFinite(parseFloat(e.weightLb))).sort((a, b) => a.date.localeCompare(b.date));
        if (!log.length) return null;
        const latest = log[log.length - 1], cur = parseFloat(latest.weightLb);
        const cutoff = addDaysISO(latest.date, -30);
        let ref = null; for (const e of log) { if (e.date <= cutoff) ref = e; }
        const prev = ref ? parseFloat(ref.weightLb) : null;
        const diff = prev != null ? cur - prev : 0;
        const trend = Math.abs(diff) < 0.1 ? null : (diff > 0 ? "up" : "down");
        return { value: Math.round(cur), unit: "lb", trend, trendNeutral: true }; } },
    { id: "bigthree", icon: "💪", label: "Top lift", get: (x) => { const b = bestBigThreeLift(x.progress, x.c); return b ? ({ value: b, unit: "lb" }) : null; } },
    { id: "lastlift", icon: "💤", label: "Days since last lift", get: (x) => {
        const dates = completionDateList(x.progress); if (!dates.length) return null;
        const last = dates[dates.length - 1];
        const n = Math.max(0, Math.round((new Date(x.today + "T12:00:00") - new Date(last + "T12:00:00")) / 86400000));
        return { value: n, unit: n === 1 ? "day" : "days" }; } },
    { id: "trophies", icon: "🏆", label: "Trophies", get: (x) => { const badges = computeBadges(x.progress, x.c); return { value: `${badges.filter((b) => b.earned).length}/${badges.length}` }; } },
    { id: "cardiomin", icon: "🏃", label: "Cardio time", get: (x) => {
        const m = cardioMinutes(x.progress); if (!m) return null;
        return { value: formatMinutes(m), unit: m < 60 ? "min" : "" }; } },
    { id: "cardioweek", icon: "🫁", label: "Cardio this week", get: (x) => {
        const thisWk = weekStartISO(x.today), lastWk = addDaysISO(thisWk, -7);
        const cur = cardioMinutes(x.progress, thisWk);
        const prev = cardioMinutes(x.progress, lastWk) - cur;
        if (!cur && !prev) return null;
        const trend = prev ? (cur > prev ? "up" : cur < prev ? "down" : null) : null;
        return { value: formatMinutes(cur), unit: cur < 60 ? "min" : "", trend }; } },
    { id: "cardiomiles", icon: "🛣️", label: "Distance", get: (x) => {
        const mi = cardioMiles(x.progress); if (!mi) return null;
        return { value: mi < 100 ? mi.toFixed(1) : Math.round(mi).toLocaleString(), unit: "mi" }; } },
    { id: "cardiosessions", icon: "👟", label: "Cardio sessions", get: (x) => {
        const n = cardioLogList(x.progress).length;
        return n ? { value: n } : null; } },
    { id: "pushups", icon: "🤸", label: "Push-ups", get: (x) => {
        const n = totalRepsMatching(x.progress, x.c, /push.?up/i);
        return n ? { value: n.toLocaleString() } : null; } },
    { id: "pullups", icon: "🧗", label: "Pull-ups", get: (x) => {
        const n = totalRepsMatching(x.progress, x.c, /(pull.?up|chin.?up)/i);
        return n ? { value: n.toLocaleString() } : null; } },
    { id: "situps", icon: "🌀", label: "Sit-ups", get: (x) => {
        const n = totalRepsMatching(x.progress, x.c, /(sit.?up|crunch)/i);
        return n ? { value: n.toLocaleString() } : null; } },
    { id: "squatreps", icon: "🦵", label: "Squat reps", get: (x) => {
        const n = totalRepsMatching(x.progress, x.c, /squat/i);
        return n ? { value: n.toLocaleString() } : null; } },
    { id: "lungereps", icon: "🚶", label: "Lunge reps", get: (x) => {
        const n = totalRepsMatching(x.progress, x.c, /lunge/i);
        return n ? { value: n.toLocaleString() } : null; } },
    { id: "totalreps", icon: "🔢", label: "Total reps", get: (x) => {
        const n = totalRepsAll(x.progress);
        return n ? { value: n.toLocaleString() } : null; } },
  ];
  const RACING_DEFAULT = ["workouts", "highestpr", "timetrained", "tonnage"];
  function getRacingStatIds(progress) {
    const ids = Array.isArray(progress?.racingStats)
      ? progress.racingStats.filter((id) => RACING_LIB.some((s) => s.id === id)) : null;
    return ids && ids.length ? ids : RACING_DEFAULT.slice();
  }
  function renderRacingRows(ctx) {
    return getRacingStatIds(ctx.progress)
      .map((id) => RACING_LIB.find((s) => s.id === id)).filter(Boolean)
      .map((def) => { const d = def.get(ctx); return d ? racingRowHtml(def.label, d) : ""; }).join("");
  }
  // Soft cap: show RACING_CAP rows, scroll the rest inside a fixed-height window
  // with a fade at whichever edge has more. Only sizes while the (collapsible)
  // stats card is open, so it's re-run on toggle.
  const RACING_CAP = 4;
  function wireRacingCap() {
    const vp = $("#racing-vp"); if (!vp) return;
    vp.classList.remove("is-capped", "at-top", "at-bottom");
    vp.style.maxHeight = "";
    const rows = vp.children.length;
    if (rows <= RACING_CAP || !vp.offsetParent) return;
    const gap = parseFloat(getComputedStyle(vp).rowGap) || 0;
    vp.style.maxHeight = (vp.children[RACING_CAP].offsetTop - gap) + "px";
    vp.classList.add("is-capped", "at-top");
    const update = () => {
      const max = vp.scrollHeight - vp.clientHeight;
      vp.classList.toggle("at-top", vp.scrollTop <= 1);
      vp.classList.toggle("at-bottom", vp.scrollTop >= max - 1);
    };
    vp.addEventListener("scroll", update, { passive: true });
    update();
  }
  // Athlete (or coach in a live session) picks which racing stats show and their order.
  function openRacingStatsCustomizer() {
    const progress = state.clientData.progress; if (!progress) return;
    const sel = getRacingStatIds(progress);
    const commit = () => { progress.racingStats = sel.slice(); saveClient(); renderAthleteOverview(); };
    const rowHtml = (def, selected, i, total) => `<div class="stat-cust-row${selected ? " on" : ""}" data-id="${def.id}">
        <span class="stat-cust-name"><span class="stat-cust-ico">${def.icon}</span>${escapeHtml(def.label)}</span>
        <span class="stat-cust-ctrls">
          ${selected ? `<button class="btn btn-ghost btn-sm" data-act="up"${i === 0 ? " disabled" : ""} title="Move up">▲</button>
          <button class="btn btn-ghost btn-sm" data-act="down"${i === total - 1 ? " disabled" : ""} title="Move down">▼</button>` : ""}
          <button class="btn ${selected ? "btn-ghost" : "btn-primary"} btn-sm" data-act="toggle">${selected ? "Remove" : "Add"}</button>
        </span>
      </div>`;
    const draw = () => {
      const selDefs = sel.map((id) => RACING_LIB.find((s) => s.id === id)).filter(Boolean);
      const poolDefs = RACING_LIB.filter((s) => !sel.includes(s.id));
      const chartOn = progress.showVolChart !== false;
      $("#modal-body").innerHTML = `
        <p class="muted stat-cust-intro">Choose the stats for your stats bar and reorder them with the arrows.</p>
        <div class="stat-cust-list">${selDefs.map((d, i) => rowHtml(d, true, i, selDefs.length)).join("") || `<p class="muted" style="padding:0.3em 0">Nothing selected yet.</p>`}</div>
        ${poolDefs.length ? `<div class="stat-cust-sub">Add more</div><div class="stat-cust-list">${poolDefs.map((d) => rowHtml(d, false)).join("")}</div>` : ""}
        <div class="stat-cust-sub">Chart</div>
        <div class="stat-cust-list"><div class="stat-cust-row${chartOn ? " on" : ""}">
          <span class="stat-cust-name"><span class="stat-cust-ico">📊</span>Volume chart</span>
          <span class="stat-cust-ctrls"><button class="btn ${chartOn ? "btn-ghost" : "btn-primary"} btn-sm" data-chart>${chartOn ? "Remove" : "Add"}</button></span>
        </div></div>`;
      $("#modal-body").querySelectorAll(".stat-cust-row[data-id]").forEach((row) => {
        const id = row.dataset.id;
        row.querySelectorAll("[data-act]").forEach((btn) => btn.addEventListener("click", () => {
          const idx = sel.indexOf(id);
          if (btn.dataset.act === "toggle") { if (idx >= 0) sel.splice(idx, 1); else sel.push(id); }
          else if (btn.dataset.act === "up" && idx > 0) { [sel[idx - 1], sel[idx]] = [sel[idx], sel[idx - 1]]; }
          else if (btn.dataset.act === "down" && idx >= 0 && idx < sel.length - 1) { [sel[idx + 1], sel[idx]] = [sel[idx], sel[idx + 1]]; }
          commit(); draw();
        }));
      });
      $("#modal-body").querySelector("[data-chart]")?.addEventListener("click", () => {
        progress.showVolChart = !chartOn; saveClient(); renderAthleteOverview(); draw();
      });
    };
    openModal({ title: "Customize stats", body: "", actions: [{ label: "Done", className: "btn btn-primary", onClick: closeModal }] });
    draw();
  }

  function renderAthleteOverview() {
    const host = $("#overview-stats");
    const heroHost = $("#overview-hero");
    const trophyHost = $("#overview-trophies");
    if (!host) return;
    const prog = state.clientData.program;
    const c = prog?.client;
    if (!c) { host.innerHTML = ""; if (heroHost) heroHost.innerHTML = ""; $("#overview-greeting") && ($("#overview-greeting").innerHTML = ""); if (trophyHost) trophyHost.innerHTML = ""; renderAthleteCoachMessages(null); return; }
    ensureSessionBank(c);
    renderAthleteCoachMessages(c);
    const progress = state.clientData.progress || {};
    const today = todayISO();

    // ---- Weekly progress (current week) ----
    const weeks = c.weeks || [];
    const activeWeekId = state.workoutView?.weekId || state.clientData.selectedWeekId || weeks[0]?.id;
    const week = weeks.find((w) => w.id === activeWeekId) || weeks[0];
    const days = week?.days || [];
    const dc = progress.dayCompletions || {};
    const isDone = (d) => Array.isArray(dc[d.id]) && dc[d.id].length;
    const totalDays = days.length;
    const doneDays = days.filter(isDone).length;
    const daysLeft = Math.max(0, totalDays - doneDays);
    const weekLabel = week?.label || "This week";
    const pct = totalDays ? Math.round((doneDays / totalDays) * 100) : 0;
    const nextDay = days.find((d) => !isDone(d)) || days[0];

    // ---- Adaptive "up next" hero: Today / Up next / Rest / All caught up ----
    const dayHero = (wkId, day, kicker) => {
      const list = (weeks.find((w) => w.id === wkId)?.days) || [];
      const col = getDayColor(Math.max(0, list.findIndex((d) => d.id === day.id)));
      return { icon: day.icon || workoutIconFor(day.name), kicker, title: escapeHtml(day.name),
        sub: "", color: col.color, soft: col.soft,
        jump: { weekId: wkId, dayId: day.id }, cta: "Start" };
    };
    const selfToday = progress.selfSchedule?.[today];
    let hero = null;
    if (!totalDays) {
      hero = { icon: "📋", kicker: "PROGRAM", title: "No program yet", sub: "Your coach is setting it up." };
    } else if (selfToday?.rest) {
      hero = { icon: "🛌", kicker: "TODAY", title: "Rest day", sub: daysLeft ? `Next up: ${escapeHtml(nextDay.name)}` : "Recover up." };
    } else if (selfToday?.weekId && selfToday?.dayId) {
      const wd = findWeekDay(c, selfToday.weekId, selfToday.dayId);
      if (wd) hero = dayHero(selfToday.weekId, wd.day, "TODAY");
    }
    if (!hero) {
      if (daysLeft > 0 && nextDay) hero = dayHero(week.id, nextDay, "UP NEXT");
      else hero = { icon: "🎉", kicker: "THIS WEEK", title: "All caught up!", sub: `${escapeHtml(weekLabel)} complete. Nice work.` };
    }

    // ---- Sessions + next booking ----
    const remaining = sessionBankSummary(c).remaining;
    const low = remaining <= 2;
    const nextBooking = (c.sessionBank.upcomingBookings || [])
      .filter((b) => b.date >= today)
      .sort((a, b) => new Date(a.startAt || a.date) - new Date(b.startAt || b.date))[0];
    let bookingLabel = "";
    if (nextBooking) {
      const wd = nextBooking.startAt ? new Date(nextBooking.startAt).toLocaleDateString(undefined, { weekday: "short" }) : "";
      bookingLabel = `${wd} ${nextBooking.time || ""}`.trim();
    }

    // ---- Bodyweight latest + trend ----
    // ---- Top PR ----
    let prHtml = "";
    const prWithVal = (c.coachPRs || []).filter((p) => p.name && p.pr1);
    if (prWithVal.length) {
      const top = prWithVal.slice().sort((a, b) => Number(b.pr1) - Number(a.pr1))[0];
      prHtml = `<div class="ov-mini"><div class="ov-mini-top"><span class="ov-mini-val">${prWeightLabel(top.name, top.pr1)}</span></div><div class="ov-mini-lbl">${escapeHtml(top.name)} 1RM</div></div>`;
    }

    const firstName = escapeHtml((c.name || "").trim().split(/\s+/)[0] || "athlete");

    // ---- Streak · ring · tonnage · recap · trophies ----
    const streakN = weeklyStreak(progress);
    const ton = lifetimeTonnage(progress);
    const lastWk = lastWorkoutVolume(progress);
    const lastWkLabel = lastWk ? new Date(lastWk.date + "T12:00:00").toLocaleDateString(undefined, { month: "short", day: "numeric" }) : "";
    // Lifetime lifting stats — the tonnage lives here (not as a mini tile too)
    const lifeStats = {
      workouts: completionDateList(progress).length,
      prs: (progress.personalRecords || []).length,
      volume: ton,
    };
    // Combined, collapsible "Lifting stats": lifetime totals + last workout + volume chart.
    const KEY_LIFTSTATS_OPEN = "trainerpro_liftstats_open_v1";
    const liftOpen = localStorage.getItem(KEY_LIFTSTATS_OPEN) !== "0";
    const racingCtx = { progress, c, today, lastWk, lastWkLabel, ton, streakN, doneDays, totalDays };
    const statsHtml = (lifeStats.workouts || ton) ? `<details class="card ov-liftstats"${liftOpen ? " open" : ""}>
        <summary><svg class="ov-liftstats-ico" viewBox="0 0 24 24" aria-hidden="true"><text class="lsi-d lsi-1" x="1" y="11">1</text><text class="lsi-d lsi-2" x="8" y="16">2</text><text class="lsi-d lsi-3" x="15" y="21">3</text></svg><span class="ov-liftstats-title">Lifting stats</span><span class="ov-liftstats-chev">▸</span></summary>
        <div class="ov-liftstats-body">
          <div class="ov-recap-head"><h4>Your stats</h4><div class="ov-recap-actions"><button class="btn btn-ghost btn-sm" id="btn-racing-customize" type="button" title="Customize these stats" aria-label="Customize these stats">⋯</button><button class="btn btn-ghost btn-sm" id="btn-share-recap" type="button">📤 Share</button></div></div>
          <div class="ov-stats-list racing-vp" id="racing-vp">${renderRacingRows(racingCtx)}</div>
          <div id="ov-volchart-host"></div>
        </div>
      </details>` : "";
    const badges = computeBadges(progress, c);
    const earnedCount = badges.filter((b) => b.earned).length;
    // Collapsed by default — the summary line carries the earned count.
    const trophyHtml = earnedCount ? `<details class="card ov-trophies">
        <summary>🏆 Trophy case <span class="muted">${earnedCount}/${badges.length}</span><span class="ov-trophies-chev">▸</span></summary>
        <div class="trophy-grid">${badges.map((b) => `<div class="trophy${b.earned ? " earned" : ""}" title="${escapeHtml(b.hint)}"><span class="trophy-icon">${b.icon}</span><span class="trophy-name">${escapeHtml(b.name)}</span></div>`).join("")}</div>
      </details>` : "";

    // "Up next" reads as a compact floating badge pinned to the bottom-center
    // of the overview (day name on top, kicker under it). The whole badge is
    // the tap target on startable states, so there's no separate Start button.
    const greetHost = $("#overview-greeting");
    if (greetHost) greetHost.innerHTML = `<div class="ov-greeting">Hey, ${firstName} 👋</div>`;
    if (heroHost) heroHost.innerHTML = `
      <div class="ov-hero${hero.jump ? " is-clickable" : ""}" id="ov-hero" style="--hero-color:${hero.color || "var(--primary-bright)"};--hero-soft:${hero.soft || "var(--primary-soft)"}">
        <div class="ov-hero-textcol">
          <span class="ov-hero-title">${hero.title}</span>
          <span class="ov-hero-kicker">${hero.kicker}</span>
        </div>
        ${hero.cta ? `<span class="ov-hero-arrow" aria-hidden="true">→</span>` : ""}
      </div>`;
    renderCalHeaderStats({ doneDays, totalDays, weekLabel, streakN, bookingLabel });
    host.innerHTML = `
      ${prHtml ? `<div class="ov-mini-row">${prHtml}</div>` : ""}
      ${statsHtml}`;
    if (trophyHost) trophyHost.innerHTML = trophyHtml;

    if (hero.jump) $("#ov-hero")?.addEventListener("click", () => jumpToWorkout(hero.jump, today));
    renderClientHeaderSessions();
    $("#btn-share-recap")?.addEventListener("click", () => shareLifetimeImage(lifeStats, c.name));
    $("#btn-racing-customize")?.addEventListener("click", openRacingStatsCustomizer);
    $(".ov-liftstats")?.addEventListener("toggle", (e) => {
      localStorage.setItem(KEY_LIFTSTATS_OPEN, e.target.open ? "1" : "0");
      if (e.target.open) wireRacingCap();
    });
    wireRacingCap();
    if (progress.showVolChart === false) { const vh = $("#ov-volchart-host"); if (vh) vh.innerHTML = ""; }
    else renderVolumeChart(progress);
  }
  // Sessions-remaining chip in the athlete header, right of the profile name.
  function renderClientHeaderSessions() {
    const chip = $("#header-sessions"); if (!chip) return;
    const c = state.clientData.program?.client;
    if (!c) { chip.classList.add("hidden"); return; }
    ensureSessionBank(c);
    const n = sessionBankSummary(c).remaining;
    chip.classList.remove("hidden");
    chip.classList.toggle("is-low", n <= 2);
    const numEl = chip.querySelector(".hs-num"); if (numEl) numEl.textContent = n;
    chip.title = `${n} session${n === 1 ? "" : "s"} left · tap to view`;
    if (!chip.dataset.wired) { chip.dataset.wired = "1"; chip.addEventListener("click", () => setClientTab("sessions")); }
  }
  // -------- Athlete self-service profile (name / age / height / weight / goals) --------
  function renderAthleteProfileFields() {
    const c = state.clientData.program?.client; if (!c) return;
    const set = (id, v) => { const el = $(id); if (el) el.value = v ?? ""; };
    set("#ath-prof-name", c.name || "");
    set("#ath-prof-age", c.age || "");
    const h = Number(c.heightIn) || 0;
    set("#ath-prof-height-ft", h ? Math.floor(h / 12) : "");
    set("#ath-prof-height-in", h ? Math.round(h % 12) : "");
    set("#ath-prof-weight", c.weightLb || "");
    set("#ath-prof-goals", c.goals || "");
  }
  function saveAthleteProfile() {
    if (state.previewMode) return; // coach preview is read-only
    const c = state.clientData.program?.client; if (!c) return;
    c.name = $("#ath-prof-name").value.trim();
    c.age = $("#ath-prof-age").value;
    c.weightLb = $("#ath-prof-weight").value;
    c.goals = $("#ath-prof-goals").value;
    const ft = Number($("#ath-prof-height-ft").value) || 0;
    const inch = Number($("#ath-prof-height-in").value) || 0;
    c.heightIn = (ft * 12 + inch) || "";
    saveClient();
    // Push vitals to the shared athletes row so the coach sees the same info.
    const athleteId = state.clientData.program?.clientId;
    if (window.Cloud?.enabled && athleteId) {
      window.Cloud.debounce(`athleteProfile:${athleteId}`, () =>
        window.Cloud.updateAthleteProfileFields(athleteId, {
          name: c.name, age: c.age, heightIn: c.heightIn, weightLb: c.weightLb, goals: c.goals,
        })
      );
    }
    const hdr = $("#client-portal-name"); if (hdr) hdr.textContent = c.name || "";
    const flag = $("#athlete-prof-saved");
    if (flag) { flag.classList.add("show"); clearTimeout(flag._t); flag._t = setTimeout(() => flag.classList.remove("show"), 1600); }
  }
  function exitClient() {
    state.mode = null;
    sessionStorage.removeItem(KEY_SESSION);
    _signOutOnLeave = false;
    if (window.Cloud?.enabled) window.Cloud.signOut();
    showLoginScreen("#login-role");
  }

  // -------- Coach live session (fill out the athlete's workout) --------
  // Renders the athlete portal off a throwaway clientData built from the coach's
  // athlete object + their last-synced progress. The portal is fully interactive
  // and every save mirrors into c.importedProgress and the athlete's cloud
  // progress — for in-person sessions where the coach enters the sets, reps,
  // and weights the athlete just completed. (The read-only preview variant was
  // retired 2026-07-17; state.previewMode still gates the save/persist paths.)
  let _previewReturn = null;
  // target (optional): { weekId, dayId, date } to land on a specific completed
  // workout — used when the coach taps an activity notification. Omitted, it
  // lands on the athlete's current day, ready to log.
  async function previewAsAthlete(target) {
    const c = currentClient();
    if (!c) return;
    ensureSessionBank(c);
    // Start from the athlete's freshest synced progress (cached copy if offline).
    try { await pullProgressFromCloud(c); } catch (e) {}
    _previewReturn = { clientData: state.clientData, mode: state.mode, clientId: c.id };
    state.previewMode = true;
    state.liveLog = true;
    document.body.classList.add("live-log-mode");
    // The clone is the working copy — saveClient() mirrors it back to the
    // athlete's row, never straight into the coach's live data.
    const program = structuredClone(buildProgramFromAthlete(c));
    const progress = c.importedProgress ? structuredClone(c.importedProgress) : emptyProgress();
    state.clientData = { program, progress };
    enterClientPortal();
    updatePreviewBanner(c);
    show($("#preview-banner"));
    // Land on the requested completed day (from a notification) or, by default,
    // the day they're currently on. The date drives which logged sets show, so
    // a past completion surfaces what they actually logged that day.
    const pos = (target && target.dayId) ? target : athleteCurrentDay(c);
    if (pos) {
      setClientTab("workouts");
      state.workoutView = { mode: "detail", weekId: pos.weekId, dayId: pos.dayId, date: pos.date || todayISO() };
      Nav.push(backToWorkoutPicker);
      renderWorkoutDetailUI();
    }
  }
  function updatePreviewBanner(c) {
    const banner = $("#preview-banner");
    if (!banner) return;
    banner.classList.add("live");
    $(".preview-banner-msg").innerHTML =
      `🏋️ Live session: logging <strong>${escapeHtml(c.name)}</strong>'s workout, saves to their account`;
  }
  function exitPreview() {
    if (!state.previewMode) return;
    // Push any pending live-session writes before tearing the preview down.
    if (state.liveLog) window.Cloud?.flush?.();
    const ret = _previewReturn; _previewReturn = null;
    state.previewMode = false;
    state.liveLog = false;
    document.body.classList.remove("preview-mode", "live-log-mode");
    hide($("#preview-banner"));
    state.clientData = ret.clientData;
    state.mode = ret.mode;
    applyTheme(currentThemeForRole("coach")); // restore coach theme after preview
    hide($("#screen-client"));
    show($("#screen-app"));
    openClient(ret.clientId);
    setTab("program"); // land on the program so edits are one tap away
  }
  function setClientTab(name) {
    $$(".tab[data-ctab]").forEach((t) => t.classList.toggle("active", t.dataset.ctab === name));
    $$(".tab-panel[data-ctab-panel]").forEach((p) => p.classList.toggle("active", p.dataset.ctabPanel === name));
    // The racing bar's soft cap can only measure once its panel is visible.
    if (name === "overview") wireRacingCap();
    // Rest timer only floats over the workouts tab (and only in day detail)
    if (name !== "workouts") { hideRestTimer(); WorkoutClock.leave(); }
    else if (state.workoutView?.mode === "detail") showRestTimer();
    // Profile has no tab button — it's reached via the header name link.
    const profLink = $("#btn-client-profile");
    if (profLink) profLink.classList.toggle("active", name === "profile");
  }

  // -------- Athlete calendar --------
  function renderAthleteCalendar() {
    const prog = state.clientData.program; if (!prog) return;
    const { year, month } = state.athleteCal;
    $("#ccal-title").textContent = `${MONTH_NAMES[month]} ${year}`;
    const grid = $("#ccal-grid");
    grid.innerHTML = "";
    DOW_LABELS.forEach((d) => {
      const el = document.createElement("div");
      el.className = "cal-dow";
      el.textContent = d;
      grid.appendChild(el);
    });
    const cells = buildMonthGrid(year, month);
    const today = todayISO();
    const selfSched = state.clientData.progress.selfSchedule || {};
    const redsByDate = redemptionsByDate(prog.client);
    const missedByD = missedByDate(prog.client);
    // Upcoming Setmore bookings the coach matched to this athlete (synced via
    // sessionBank.upcomingBookings) → a "📅 time" pill on those future days.
    const upcomingByDate = {};
    (prog.client.sessionBank?.upcomingBookings || []).forEach((b) => {
      if (b && b.date) (upcomingByDate[b.date] = upcomingByDate[b.date] || []).push(b);
    });
    // Scheduled one-off coach sessions → a 🐉 pill until they're completed.
    const oneOffByDate = {};
    (prog.client.oneOffDays || []).forEach((d) => {
      if (d && d.date) (oneOffByDate[d.date] = oneOffByDate[d.date] || []).push(d);
    });
    cells.forEach((d) => {
      const iso = dateISO(d);
      const inMonth = d.getMonth() === month;
      const cell = document.createElement("div");
      cell.className = "cal-day";
      if (!inMonth) cell.classList.add("outside");
      if (iso === today) cell.classList.add("today");
      const isUpcoming = iso >= today;
      const entry = selfSched[iso];
      const completed = findCompletedDayForDate(prog.client, iso);
      let pillHtml = "";
      if (completed && completed.oneOff) {
        pillHtml = `<div class="cal-day-pill cal-oneoff-pill">✓ 🐉 ${escapeHtml(completed.day.name || "Coach session")}</div>`;
        cell.classList.add("done");
        if (isUpcoming) cell.classList.add("has-log");
      } else if (completed) {
        const dIdx = getDayIdx(prog.client, completed.week.id, completed.day.id);
        const dc = getDayColor(dIdx);
        const label = weekDayLabel(prog.client, completed.week.id, completed.day.id);
        pillHtml = `<div class="cal-day-pill" style="--day-color:${dc.color};--day-color-soft:${dc.soft}">✓ ${escapeHtml(label)}</div>`;
        cell.classList.add("done");
        if (isUpcoming) cell.classList.add("has-log");
      } else if (isUpcoming && entry && entry.weekId) {
        // Only show/allow planned days that haven't passed yet — once a
        // planned date is in the past and never got auto-completed, the
        // plan is stale and just drops off the calendar.
        const dIdx = getDayIdx(prog.client, entry.weekId, entry.dayId);
        const dc = getDayColor(dIdx);
        const label = weekDayLabel(prog.client, entry.weekId, entry.dayId);
        pillHtml = `<div class="cal-day-pill" style="--day-color:${dc.color};--day-color-soft:${dc.soft}">${escapeHtml(label)}</div>`;
        cell.classList.add("has-log");
      } else if (isUpcoming && entry?.rest) {
        pillHtml = `<div class="cal-day-pill cal-day-pill-rest">Rest</div>`;
        cell.classList.add("has-log");
      }
      const upc = isUpcoming ? (upcomingByDate[iso] || []) : [];
      if (upc.length) {
        pillHtml += upc.map((b) => `<div class="cal-day-pill cal-booked-pill">${escapeHtml(b.time || "Session")}</div>`).join("");
        cell.classList.add("has-log");
      }
      const oneOffs = isUpcoming ? (oneOffByDate[iso] || []).filter((d) => !isDayChecked(d.id)) : [];
      if (oneOffs.length) {
        pillHtml += oneOffs.map((d) => `<div class="cal-day-pill cal-oneoff-pill">🐉 ${escapeHtml(d.name || "Coach session")}</div>`).join("");
        cell.classList.add("has-log");
      }
      // Missed-session marks from the coach (close call = green freebie,
      // charged = dark). A charged mark replaces its token pill so the day
      // reads "✕ Missed" instead of a generic 🎟.
      const missed = missedByD[iso] || [];
      const chargedUids = new Set(missed.filter((m) => m.type === "charged" && m.setmoreUid).map((m) => m.setmoreUid));
      const reds = (redsByDate[iso] || []).filter((r) => !chargedUids.has(r.setmoreUid));
      if (reds.length) pillHtml += tokenPillHtml(reds);
      if (missed.length) { pillHtml += missedPillHtml(missed); cell.classList.add("has-log"); }
      cell.innerHTML = `<div class="cal-date-num">${d.getDate()}</div>${pillHtml}`;
      // Athletes can only plan today/future days here — completion itself
      // is auto-detected from locked-in exercise logs, not hand-picked.
      if (inMonth && isUpcoming) {
        cell.addEventListener("click", () => openAthleteLogDayModal(iso));
      } else if (inMonth && (reds.length || missed.length)) {
        // Past days aren't plannable, so a tap can surface the redemption
        // details instead (title tooltips don't exist on mobile).
        cell.classList.add("has-log");
        cell.addEventListener("click", () => openRedemptionDetailsModal(iso, reds, missed));
      }
      grid.appendChild(cell);
    });
    // Token balance chip — only shown once the athlete has a session bank.
    const balEl = $("#ccal-token-balance");
    if (balEl) {
      const sum = sessionBankSummary(prog.client);
      if (sum.granted > 0 || sum.used > 0) {
        balEl.textContent = `🎟 ${sum.remaining} session${Math.abs(sum.remaining) === 1 ? "" : "s"} left`;
        show(balEl);
      } else {
        hide(balEl);
      }
    }
    if (typeof renderAthleteOverview === "function") renderAthleteOverview(); // weekly days-left tracks completions
  }

  function openAthleteLogDayModal(iso) {
    const prog = state.clientData.program; if (!prog) return;
    const selfSched = state.clientData.progress.selfSchedule || {};
    const existing = selfSched[iso];
    const client = prog.client;
    if (!client.weeks.length) {
      openModal({ title: `Plan ${iso}`, body: `<p class="muted">No weeks in this program yet.</p>`, actions: [{ label: "Close", className: "btn btn-ghost", onClick: closeModal }] });
      return;
    }
    let activeWeekId = existing?.weekId || client.weeks[0].id;

    const restSel = existing?.rest ? " selected" : "";
    const restHtml = `<button class="day-log-opt day-log-rest${restSel}" data-rest="1" type="button">
      <span class="day-log-icon day-log-icon-rest">🛌</span>
      <span class="day-log-name">Rest day</span>
    </button>`;
    const weekChipsHtml = client.weeks.map((week) => `
      <button class="week-chip day-log-week-chip${week.id === activeWeekId ? " active" : ""}${week.phaseLabel ? " has-phase" : ""}" data-week="${escapeHtml(week.id)}" type="button">
        ${week.phaseLabel ? `<span class="chip-phase">${escapeHtml(week.phaseLabel)}</span>` : ""}
        <span class="chip-label">${escapeHtml(week.label)}</span>
      </button>
    `).join("");
    const bodyHtml = `
      <div class="day-log-picker">
        ${restHtml}
        <div class="week-chips day-log-week-chips">${weekChipsHtml}</div>
        <div class="day-log-day-grid" id="day-log-day-grid"></div>
      </div>`;

    const actions = [{ label: "Cancel", className: "btn btn-ghost", onClick: closeModal }];
    if (existing) actions.push({ label: "Clear", className: "btn btn-ghost", onClick: () => {
      if (!state.clientData.progress.selfSchedule) state.clientData.progress.selfSchedule = {};
      delete state.clientData.progress.selfSchedule[iso];
      saveClient(); renderAthleteCalendar(); closeModal();
    }});
    openModal({ title: `Plan for ${iso}`, body: bodyHtml, actions });

    function renderDayGrid() {
      const week = client.weeks.find((w) => w.id === activeWeekId);
      const gridEl = $("#day-log-day-grid");
      if (!week || !week.days.length) {
        gridEl.innerHTML = `<p class="muted" style="padding:0.4rem 0.1rem">No workout days in this week.</p>`;
        return;
      }
      gridEl.innerHTML = week.days.map((day, dIdx) => {
        const dc = getDayColor(dIdx);
        const sel = (activeWeekId === existing?.weekId && day.id === existing?.dayId) ? " selected" : "";
        const icon = day.icon || workoutIconFor(day.name);
        return `<button class="day-log-opt${sel}" data-week="${escapeHtml(week.id)}" data-day="${escapeHtml(day.id)}"
          style="--day-color:${dc.color};--day-color-soft:${dc.soft}" type="button">
          <span class="day-log-icon">${dayIconHtml(icon)}</span>
          <span class="day-log-name">${escapeHtml(day.name)}</span>
        </button>`;
      }).join("");
      gridEl.querySelectorAll(".day-log-opt").forEach((btn) => {
        btn.addEventListener("click", () => {
          if (!state.clientData.progress.selfSchedule) state.clientData.progress.selfSchedule = {};
          state.clientData.progress.selfSchedule[iso] = { weekId: btn.dataset.week, dayId: btn.dataset.day, loggedAt: Date.now() };
          saveClient(); renderAthleteCalendar(); closeModal(); toast("Planned ✓");
        });
      });
    }
    renderDayGrid();

    $("#modal-body .day-log-rest").addEventListener("click", () => {
      if (!state.clientData.progress.selfSchedule) state.clientData.progress.selfSchedule = {};
      state.clientData.progress.selfSchedule[iso] = { rest: true, loggedAt: Date.now() };
      saveClient(); renderAthleteCalendar(); closeModal(); toast("Planned ✓");
    });
    $("#modal-body").querySelectorAll(".day-log-week-chip").forEach((chip) => {
      chip.addEventListener("click", () => {
        activeWeekId = chip.dataset.week;
        $("#modal-body").querySelectorAll(".day-log-week-chip").forEach((c) => c.classList.toggle("active", c.dataset.week === activeWeekId));
        renderDayGrid();
      });
    });
  }
  function jumpToWorkout(sched, iso) {
    state.__jumpTo = { weekId: sched.weekId, dayId: sched.dayId, date: iso };
    setClientTab("workouts");
    renderClientWorkouts();
    setTimeout(() => {
      const target = document.querySelector(`.client-exercise-card[data-week="${sched.weekId}"]`);
      if (target) target.scrollIntoView({ behavior: "smooth", block: "start" });
    }, 50);
  }

  // -------- Athlete workouts --------
  // Athlete-side workout view state (which week chip + day card is active).
  state.workoutView = state.workoutView || { mode: "picker", weekId: null, dayId: null, date: todayISO() };

  function renderClientWorkouts() {
    const prog = state.clientData.program;
    const picker = $("#workout-picker");
    const detail = $("#workout-detail");

    if (!prog?.client?.weeks?.length) {
      picker.querySelector(".workout-grid").innerHTML = "";
      picker.querySelector(".week-chips").innerHTML = "";
      const empty = `<div class="empty-state"><div class="empty-emoji">📋</div><h3>No weeks yet</h3><p>Your coach hasn't added any weeks to your program yet.</p></div>`;
      picker.querySelector(".workout-grid").innerHTML = empty;
      // One-off coach sessions can exist without a program — still show them.
      renderAthleteOneOffSection();
      if (state.workoutView.weekId === "oneoff" && state.workoutView.mode === "detail" && state.workoutView.dayId) {
        renderWorkoutDetailUI();
        return;
      }
      hide(detail); show(picker);
      return;
    }

    const jumpTo = state.__jumpTo;
    state.__jumpTo = null;

    // If a jump-to was set (from calendar click), prefer it.
    if (jumpTo?.weekId && jumpTo?.dayId) {
      state.workoutView = { mode: "detail", weekId: jumpTo.weekId, dayId: jumpTo.dayId, date: jumpTo.date || todayISO() };
    } else if (!state.workoutView.weekId) {
      // Restore the last week the athlete was on (persisted across reopens),
      // falling back to the first week if it's gone or was never set.
      const saved = state.clientData.selectedWeekId;
      state.workoutView.weekId = (saved && prog.client.weeks.some((w) => w.id === saved))
        ? saved
        : prog.client.weeks[0].id;
    } else if (state.workoutView.weekId !== "oneoff" && !prog.client.weeks.some((w) => w.id === state.workoutView.weekId)) {
      // Stored week no longer exists (program edited) — fall back to first.
      // ("oneoff" is the one-off coach-session pseudo-week, never in weeks.)
      state.workoutView.weekId = prog.client.weeks[0].id;
    }

    renderWorkoutPickerUI();
    renderClientArchive(prog.client);

    if (state.workoutView.mode === "detail" && state.workoutView.dayId) {
      renderWorkoutDetailUI();
    } else {
      hide($("#workout-detail"));
      show($("#workout-picker"));
    }
  }

  function renderClientArchive(client) {
    const container = $("#client-archive-container");
    if (!container) return;
    const archives = client?.archivedPrograms;
    if (!archives || !archives.length) { container.innerHTML = ""; return; }
    container.innerHTML = "";
    const section = document.createElement("details");
    section.className = "archive-section";
    const summary = document.createElement("summary");
    summary.className = "archive-summary";
    summary.textContent = `📁 Past Programs (${archives.length})`;
    section.appendChild(summary);
    archives.forEach((prog) => {
      const card = document.createElement("div");
      card.className = "archive-prog-card";
      const d = prog.archivedAt ? new Date(prog.archivedAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }) : "";
      const exTotal = prog.weeks.reduce((n, w) => n + w.days.reduce((m, dd) => m + dd.exercises.length, 0), 0);
      const head = document.createElement("div");
      head.className = "archive-prog-head";
      head.innerHTML = `
        <div class="archive-prog-info">
          <span class="archive-prog-label">${escapeHtml(prog.label)}</span>
          <span class="archive-prog-meta">${prog.weeks.length} week${prog.weeks.length === 1 ? "" : "s"} · ${exTotal} exercise${exTotal === 1 ? "" : "s"}${d ? " · saved " + escapeHtml(d) : ""}</span>
        </div>
        <button class="btn btn-ghost btn-xs" data-action="toggle">Expand</button>`;
      const body = document.createElement("div");
      body.className = "archive-prog-body hidden";
      prog.weeks.forEach((week) => body.appendChild(renderArchiveWeek(week, false)));
      head.querySelector('[data-action="toggle"]').addEventListener("click", () => {
        const open = body.classList.toggle("hidden");
        head.querySelector('[data-action="toggle"]').textContent = open ? "Expand" : "Collapse";
      });
      card.appendChild(head);
      card.appendChild(body);
      section.appendChild(card);
    });
    container.appendChild(section);
  }

  function renderWorkoutPickerUI() {
    const prog = state.clientData.program;
    if (!prog?.client?.weeks?.length) return;
    const chips = $("#workout-week-chips");
    const grid = $("#workout-day-grid");

    // Every week gets a chip — the row wraps (.week-chips is flex-wrap). A cap
    // used to hide weeks past the 4th behind a "See all weeks" panel that no
    // longer exists, which stranded weeks 5+ of longer programs entirely.
    const pickerWeeks = prog.client.weeks;
    // Clamp the active week to the visible set so chips and day grid stay in
    // sync — except the "oneoff" pseudo-week (a coach-session detail view is
    // open; the picker is hidden behind it and must not steal its week id).
    if (state.workoutView.weekId !== "oneoff" && !pickerWeeks.some((w) => w.id === state.workoutView.weekId)) {
      state.workoutView.weekId = pickerWeeks[0]?.id || null;
    }

    // Week chips
    chips.innerHTML = "";
    pickerWeeks.forEach((week) => {
      const chip = document.createElement("button");
      chip.className = "week-chip";
      if (week.id === state.workoutView.weekId) chip.classList.add("active");
      if (week.phaseLabel) chip.classList.add("has-phase");
      chip.innerHTML = `
        ${week.phaseLabel ? `<span class="chip-phase">${escapeHtml(week.phaseLabel)}</span>` : ""}
        <span class="chip-label">${escapeHtml(week.label)}</span>
      `;
      chip.addEventListener("click", () => {
        state.workoutView.weekId = week.id;
        // Remember the athlete's week so reopening the program returns here.
        state.clientData.selectedWeekId = week.id;
        saveClient();
        renderWorkoutPickerUI();
      });
      chips.appendChild(chip);
    });

    // Day cards for the active week
    const week = prog.client.weeks.find((w) => w.id === state.workoutView.weekId);
    grid.innerHTML = "";
    if (!week || !week.days.length) {
      grid.innerHTML = `<div class="empty-state"><div class="empty-emoji">🛏️</div><h3>Rest week</h3><p>No workouts in this week.</p></div>`;
      return;
    }
    week.days.forEach((day, idx) => {
      const card = document.createElement("button");
      card.className = "workout-card";
      const dc = getDayColor(idx);
      card.style.setProperty("--day-color", dc.color);
      card.style.setProperty("--day-color-soft", dc.soft);
      const totalEx = day.exercises.length;
      const doneEx = day.exercises.filter((ex) => hasAnyLog(ex)).length;
      const checked = isDayChecked(day.id);
      const allLogged = doneEx >= totalEx && totalEx > 0;
      if (checked || allLogged) card.classList.add("is-done");
      else if (doneEx > 0) card.classList.add("is-partial");
      card.style.animationDelay = `${idx * 60}ms`;
      // Branded line icons only in this view: honor a coach-picked SVG token,
      // otherwise auto-match from the day name. Coach-picked EMOJI are shown
      // as branded icons here too (they still show in the coach editor).
      const icon = isSvgIcon(day.icon) ? day.icon : workoutIconFor(day.name);
      const status = checked
        ? `<span class="wc-status done">Done ✓</span>`
        : doneEx > 0
          ? `<span class="wc-status progress">${doneEx}/${totalEx} logged</span>`
          : `<span class="wc-status todo">Tap to start</span>`;
      const moods = dayMoods(state.clientData.progress, day.id);
      card.innerHTML = `
        <div class="workout-card-icon">${dayIconHtml(icon)}</div>
        <div class="workout-card-body">
          <h4 class="workout-card-title">${escapeHtml(day.name)}</h4>
          <div class="workout-card-meta">${totalEx} exercise${totalEx === 1 ? "" : "s"} · ${status}</div>
          ${moods.length ? moodChipsHtml(moods) : ""}
        </div>
        <div class="workout-card-chevron">›</div>
      `;
      card.addEventListener("click", () => {
        state.workoutView = { mode: "detail", weekId: week.id, dayId: day.id, date: todayISO() };
        Nav.push(backToWorkoutPicker); // Back returns to the day list, not out of the app
        renderWorkoutDetailUI();
      });
      grid.appendChild(card);
    });
    renderAthleteOneOffSection();
  }

  // -------- One-off coach sessions (athlete side) --------
  // Dated days the coach set up outside the program. Same logging flow as a
  // program day; the shim week id "oneoff" routes detail-view lookups.
  function oneOffWeekShim(client, day) {
    const dateLbl = day?.date
      ? new Date(day.date + "T12:00:00").toLocaleDateString(undefined, { weekday: "long", month: "short", day: "numeric" })
      : "";
    return { id: "oneoff", label: "Session with Coach", focus: dateLbl, phaseLabel: "1-off", days: client.oneOffDays || [] };
  }
  function renderAthleteOneOffSection() {
    const host = $("#oneoff-athlete-container");
    if (!host) return;
    host.innerHTML = "";
    const client = state.clientData.program?.client;
    const sessions = client?.oneOffDays || [];
    if (!sessions.length) return;
    const today = todayISO();
    const sec = document.createElement("div");
    sec.className = "oneoff-athlete-section";
    sec.innerHTML = `<div class="oneoff-athlete-head">🐉 Sessions with Coach</div>`;
    const grid = document.createElement("div");
    grid.className = "workout-grid";
    [...sessions]
      .sort((a, b) => String(b.date || "").localeCompare(String(a.date || "")))
      .forEach((day, idx) => {
        const totalEx = (day.exercises || []).length;
        const doneEx = (day.exercises || []).filter((ex) => hasAnyLog(ex)).length;
        const checked = isDayChecked(day.id);
        const card = document.createElement("button");
        card.className = "workout-card oneoff-workout-card";
        if (checked || (totalEx > 0 && doneEx >= totalEx)) card.classList.add("is-done");
        else if (doneEx > 0) card.classList.add("is-partial");
        card.style.animationDelay = `${idx * 60}ms`;
        const dateLbl = day.date
          ? new Date(day.date + "T12:00:00").toLocaleDateString(undefined, { weekday: "short", month: "short", day: "numeric" })
          : "";
        const status = checked
          ? `<span class="wc-status done">Done ✓</span>`
          : doneEx > 0
            ? `<span class="wc-status progress">${doneEx}/${totalEx} logged</span>`
            : (day.date >= today
              ? `<span class="wc-status todo">Coming up</span>`
              : `<span class="wc-status todo">Tap to log</span>`);
        card.innerHTML = `
          <div class="workout-card-icon">${dayIconHtml(isSvgIcon(day.icon) ? day.icon : "sd:flame")}</div>
          <div class="workout-card-body">
            <h4 class="workout-card-title">${escapeHtml(day.name || "Coach session")}</h4>
            <div class="workout-card-meta">${dateLbl ? escapeHtml(dateLbl) + " · " : ""}${totalEx} exercise${totalEx === 1 ? "" : "s"} · ${status}</div>
          </div>
          <div class="workout-card-chevron">›</div>`;
        card.addEventListener("click", () => {
          state.workoutView = { mode: "detail", weekId: "oneoff", dayId: day.id, date: todayISO() };
          Nav.push(backToWorkoutPicker);
          renderWorkoutDetailUI();
        });
        grid.appendChild(card);
      });
    sec.appendChild(grid);
    host.appendChild(sec);
  }

  // Pick a fun emoji based on day name keywords. Pure UI flavor.
  // Branded line icons per day type (the athlete picker's look). Emoji are
  // gone from the picker — coach-set SVG tokens win, otherwise keyword match.
  function workoutIconFor(name) {
    const n = String(name || "").toLowerCase();
    if (/(squat|lower|leg|quad|hamstring|glute|calf)/.test(n)) return "sd:mountain";
    if (/(deadlift|pull|back|row|lat)/.test(n)) return "sd:talon";
    if (/(push|chest|bench|press|shoulder|delt|tricep)/.test(n)) return "sd:press";
    if (/(bicep|arm|curl)/.test(n)) return "sd:claw";
    if (/(core|abs|trunk)/.test(n)) return "sd:scale";
    if (/(cardio|condition|run|sprint|hiit)/.test(n)) return "sd:flame";
    if (/(rest|recovery|mobility|stretch|yoga)/.test(n)) return "sd:moon";
    return "sd:claw";
  }

  function renderDayNoteBlock(dayId) {
    const notes = state.clientData.progress.dayNotes || {};
    const existing = notes[dayId] || "";

    const block = document.createElement("div");
    block.className = "day-note-block";

    const toggle = document.createElement("button");
    toggle.className = "day-note-toggle" + (existing ? " has-note" : "");
    toggle.innerHTML = `<span class="day-note-icon">✏️</span> <span class="day-note-label">${existing ? "Session note" : "Add a note for your coach"}</span><span class="day-note-chevron">${existing ? "›" : "+"}</span>`;

    const area = document.createElement("div");
    area.className = "day-note-area hidden";

    const ta = document.createElement("textarea");
    ta.className = "day-note-ta";
    ta.placeholder = "How did the session feel? Any aches, PRs, adjustments you made…";
    ta.rows = 4;
    ta.value = existing;
    ta.addEventListener("input", () => {
      if (!state.clientData.progress.dayNotes) state.clientData.progress.dayNotes = {};
      state.clientData.progress.dayNotes[dayId] = ta.value;
      saveClient();
      toggle.classList.toggle("has-note", !!ta.value.trim());
      toggle.querySelector(".day-note-label").textContent = ta.value.trim() ? "Session note" : "Add a note for your coach";
    });

    area.appendChild(ta);
    block.appendChild(toggle);
    block.appendChild(area);

    let open = !!existing;
    area.classList.toggle("hidden", !open);
    toggle.querySelector(".day-note-chevron").textContent = open ? "›" : "+";

    toggle.addEventListener("click", () => {
      open = !open;
      area.classList.toggle("hidden", !open);
      toggle.querySelector(".day-note-chevron").textContent = open ? "›" : "+";
      if (open) setTimeout(() => ta.focus(), 50);
    });

    return block;
  }

  // -------- Day progress (floating bottom bar + per-card fill lines) --------
  // Every exercise card rendered in the open day registers a getter that
  // reports { done, total } in set units (working sets for lifts, rounds for
  // holds). The floating bar sums them live as the athlete logs.
  let _dayProgressGetters = [];
  let _dayProgressOn = false;
  function resetDayProgress() { _dayProgressGetters = []; }
  function registerDayProgress(fn) { _dayProgressGetters.push(fn); }
  function showDayProgress() {
    _dayProgressOn = state.workoutView?.mode === "detail";
    updateDayProgressBar();
  }
  function hideDayProgress() {
    _dayProgressOn = false;
    const el = $("#day-progress"); if (el) hide(el);
  }
  function updateDayProgressBar() {
    const el = $("#day-progress"); if (!el) return;
    if (!_dayProgressOn) { hide(el); return; }
    let done = 0, total = 0;
    _dayProgressGetters.forEach((g) => {
      try { const r = g(); done += r.done; total += r.total; } catch (e) {}
    });
    if (!total) { hide(el); return; }
    show(el);
    const pct = Math.min(100, Math.round((done / total) * 100));
    $("#day-progress-fill").style.width = pct + "%";
    el.classList.toggle("complete", pct >= 100);
    $("#day-progress-label").textContent = pct >= 100 ? "Day done 🎉" : `${done}/${total} sets`;
  }

  function renderWorkoutDetailHeader(week, day) {
    if (!state.workoutView.date) state.workoutView.date = todayISO();
    const head = $("#workout-detail-head");
    const totalEx = day.exercises.length;
    const doneEx = day.exercises.filter((ex) => hasAnyLog(ex)).length;
    const checked = isDayChecked(day.id);
    const moods = dayMoods(state.clientData.progress, day.id);
    // One compact progress pill: done → count-of-total → plain count.
    const progHtml = checked
      ? `<span class="dh-progress done">Done ✓</span>`
      : doneEx > 0
        ? `<span class="dh-progress going">${doneEx}/${totalEx} logged</span>`
        : `<span class="dh-progress">${totalEx} exercise${totalEx === 1 ? "" : "s"}</span>`;
    head.innerHTML = `
      <div class="detail-head-top">
        ${week.phaseLabel ? `<span class="phase-badge">${escapeHtml(week.phaseLabel)}</span>` : ""}
        <span class="dh-week">${escapeHtml(week.label)}${week.focus ? " · " + escapeHtml(week.focus) : ""}</span>
        <input type="date" class="detail-log-date" id="detail-log-date" value="${escapeHtml(state.workoutView.date)}" title="Date these logs are for" />
      </div>
      <div class="detail-head-main">
        <button class="day-check-toggle ${checked ? "checked" : ""}" id="detail-toggle" aria-label="Mark whole day complete">${checked ? "✓" : ""}</button>
        <h2>${escapeHtml(day.name)}</h2>
        ${progHtml}
        <button type="button" class="detail-mood-btn ${moods.length ? "has-mood" : ""}" id="detail-mood-btn" title="How was your workout?" aria-label="How was your workout?">${moods.length ? moodChipsHtml(moods, true) : "🫀"}</button>
      </div>
    `;
    head.querySelector("#detail-mood-btn").addEventListener("click", () => openWorkoutMoodSheet(day));
    head.querySelector("#detail-toggle").addEventListener("click", () => {
      toggleDayComplete(day.id);
      toast(checked ? "Unchecked" : "Day complete ✓");
      renderWorkoutDetailUI();
    });
    head.querySelector("#detail-log-date").addEventListener("change", (e) => {
      state.workoutView.date = e.target.value || todayISO();
      renderWorkoutDetailUI();
    });
    // Day-level "Clear day" was retired 2026-07-22 — each exercise's Tools menu
    // now owns clearing its own numbers, so the day-wide button was redundant.
  }

  // -------- Active workout-time clock (feeds the "Time trained" lifetime stat) --------
  // Accumulates real training time while a real athlete is inside a day's workout
  // detail. Counts gaps between interactions up to a 5-minute idle cutoff (so
  // normal between-set rests and locked screens still count) but drops longer
  // gaps as "walked away". Commits are chunked (on tab change / backgrounding)
  // so nothing is lost if the app is killed. Never runs coach-side.
  const WorkoutClock = (() => {
    const IDLE_MS = 5 * 60 * 1000;         // gaps longer than this don't count
    const COMMIT_CAP_MS = 3 * 60 * 60 * 1000; // sanity cap per committed chunk
    let active = false, accum = 0, lastActive = 0;
    const eligible = () => state.mode === "client" && !state.previewMode;
    function flush(now) { if (!active) return; const gap = now - lastActive; if (gap > 0 && gap <= IDLE_MS) accum += gap; lastActive = now; }
    function commit() {
      const add = Math.min(accum, COMMIT_CAP_MS); accum = 0;
      if (add < 1000) return;
      const p = state.clientData.progress; if (!p) return;
      p.totalWorkoutMs = (p.totalWorkoutMs || 0) + add;
      saveClient();
    }
    return {
      enter() { if (!eligible()) return; const now = Date.now(); if (active) { flush(now); return; } active = true; accum = 0; lastActive = now; },
      touch() { if (active) flush(Date.now()); },
      leave() { if (!active) return; flush(Date.now()); active = false; commit(); },
      // Backgrounding: bank what we have but keep the session open for return.
      onHidden() { if (!active) return; flush(Date.now()); commit(); },
      onVisible() { if (active) lastActive = Date.now(); },
    };
  })();

  function renderWorkoutDetailUI() {
    const prog = state.clientData.program;
    let week = prog?.client?.weeks?.find((w) => w.id === state.workoutView.weekId);
    let day = week?.days?.find((d) => d.id === state.workoutView.dayId);
    if (state.workoutView.weekId === "oneoff") {
      day = (prog?.client?.oneOffDays || []).find((d) => d.id === state.workoutView.dayId) || null;
      week = day ? oneOffWeekShim(prog.client, day) : null;
    }
    if (!week || !day) {
      // Day was removed; bail back to picker.
      state.workoutView = { mode: "picker", weekId: week?.id || null, dayId: null };
      hide($("#workout-detail")); show($("#workout-picker"));
      return;
    }

    renderWorkoutDetailHeader(week, day);

    resetDayProgress(); // cards rendered below re-register their set counts
    const list = $("#workout-detail-list");
    list.innerHTML = "";
    const addedList = (state.clientData.progress?.addedExercises?.[day.id]) || [];
    if (!day.exercises.length && !addedList.length) {
      list.innerHTML = `<div class="empty-state"><div class="empty-emoji">💤</div><p>No exercises for this day.</p></div>`;
    } else if (day.exercises.length) {
      const renderer = (ex) => renderClientExercise(week, day, ex, null);
      const isSpeedEx = (e) => e.kind === "mobility" && isSpeedName(e.name);
      const isStretchEx = (e) => e.kind === "mobility" && !isSpeedName(e.name);
      const speedTop = day.exercises.filter((e) => isSpeedEx(e) && e.mobPlacement !== "bottom");
      const speedBottom = day.exercises.filter((e) => isSpeedEx(e) && e.mobPlacement === "bottom");
      const mobTop = day.exercises.filter((e) => isStretchEx(e) && e.mobPlacement !== "bottom");
      const mobBottom = day.exercises.filter((e) => isStretchEx(e) && e.mobPlacement === "bottom");
      const main = day.exercises.filter((e) => e.kind !== "mobility");
      if (speedTop.length) {
        const sec = mobilitySection("⚡ Speed & Agility");
        appendExerciseGroups(sec, { exercises: speedTop }, renderer, true);
        list.appendChild(sec);
      }
      if (mobTop.length) {
        const sec = mobilitySection("🧘 Mobility & Stretching");
        appendExerciseGroups(sec, { exercises: mobTop }, renderer, true);
        list.appendChild(sec);
      }
      appendExerciseGroups(list, { exercises: main }, renderer, true);
      if (mobBottom.length) {
        const sec = mobilitySection("🧘 Finisher Stretches");
        appendExerciseGroups(sec, { exercises: mobBottom }, renderer, true);
        list.appendChild(sec);
      }
      if (speedBottom.length) {
        const sec = mobilitySection("⚡ Speed & Agility Finisher");
        appendExerciseGroups(sec, { exercises: speedBottom }, renderer, true);
        list.appendChild(sec);
      }
    }

    // Exercises the athlete added on the fly — their own section, each with a
    // remove control. Same logger as programmed lifts, so logs still feed PRs.
    if (addedList.length) {
      const sec = document.createElement("div");
      sec.className = "added-ex-section";
      const head = document.createElement("div");
      head.className = "added-ex-head";
      head.innerHTML = `<span class="added-ex-head-title">➕ Added by you</span><span class="added-ex-head-count">${addedList.length}/${MAX_ADDED_PER_DAY}</span>`;
      sec.appendChild(head);
      addedList.forEach((ex) => {
        const card = renderClientExercise(week, day, ex, null);
        const rm = document.createElement("button");
        rm.type = "button";
        rm.className = "added-ex-remove";
        rm.innerHTML = "✕ Remove";
        rm.title = "Remove this exercise you added";
        rm.addEventListener("click", (e) => { e.stopPropagation(); removeAthleteExercise(day, ex); });
        card.appendChild(rm);
        sec.appendChild(card);
      });
      list.appendChild(sec);
    }

    // "+ Add an exercise" — opens the library drawer; capped per day.
    const addWrap = document.createElement("div");
    addWrap.className = "added-ex-addwrap";
    if (addedList.length >= MAX_ADDED_PER_DAY) {
      addWrap.innerHTML = `<p class="added-ex-cap">You've added the max of ${MAX_ADDED_PER_DAY} extra exercises for this day.</p>`;
    } else {
      const addBtn = document.createElement("button");
      addBtn.type = "button";
      addBtn.className = "btn btn-ghost added-ex-addbtn";
      addBtn.innerHTML = "＋ Add an exercise";
      addBtn.title = "Add an exercise from the library if you did more today";
      addBtn.addEventListener("click", () => openAthleteExLibrary(day));
      addWrap.appendChild(addBtn);
    }
    list.appendChild(addWrap);

    list.appendChild(renderDayNoteBlock(day.id));

    hide($("#workout-picker"));
    show($("#workout-detail"));
    WorkoutClock.enter(); // idempotent; also registers the interaction on re-render
    showRestTimer();
    // Keep the picker grid count fresh in case user comes back.
    renderWorkoutPickerUI();
    // Scroll detail into view smoothly.
    setTimeout(() => $("#workout-detail")?.scrollIntoView({ behavior: "smooth", block: "start" }), 30);
  }

  function backToWorkoutPicker() {
    WorkoutClock.leave();
    Nav.reset(); // athlete workouts root — the day list
    state.workoutView.mode = "picker";
    state.workoutView.dayId = null;
    // Leaving a one-off coach session: land back on a real program week.
    if (state.workoutView.weekId === "oneoff") {
      state.workoutView.weekId = state.clientData.selectedWeekId || null;
    }
    hideRestTimer();
    renderWorkoutPickerUI();
    hide($("#workout-detail"));
    show($("#workout-picker"));
  }
  function isLogEntryLocked(l, ex, numSets) {
    if (!l) return false;
    if (l.locked === true) return true;
    if (l.locked === false) return false;
    // Legacy entries saved before the lock-in feature existed have no
    // `locked` flag — fall back to the full-completion check so past
    // workouts don't retroactively uncheck.
    if (!l.sets || l.sets.length < numSets) return false;
    return l.sets.every((s) => s.reps && (s.weight || ex.currentWeight === "BW"));
  }
  function hasAnyLog(ex) {
    const logs = state.clientData.progress?.exerciseLogs?.[ex.id];
    if (!logs || !logs.length) return false;
    const numSets = parseInt(ex.sets) || 0;
    if (!numSets) return logs.length > 0;
    return logs.some((l) => isLogEntryLocked(l, ex, numSets));
  }
  // Warm-up holds render above the exercises, finisher holds below.
  function mobilitySection(label) {
    const sec = document.createElement("div");
    sec.className = "mobility-section";
    const h = document.createElement("div");
    h.className = "mobility-section-head";
    h.textContent = label || "🧘 Mobility & Stretching";
    sec.appendChild(h);
    return sec;
  }
  function exerciseDisplayLabel(ex) {
    const before = [];
    const after = [];
    orderedModifiers(ex).forEach((tag) => {
      const g = groupForTag(tag);
      if (!g) return;
      (g.group === "Style" || g.group === "Hold" ? after : before).push(tag);
    });
    return [...before, ex.name || "(unnamed)", ...after].join(" ");
  }
  // Mobility / stretching card: hold-for-time, no weight logging. The athlete
  // taps a checkmark per round; the row is "done" once every round is checked.
  // Name · prescription · round checks all sit on one horizontal line.
  function renderClientMobility(week, day, ex, jumpTo) {
    const numRounds = parseInt(ex.sets) || 0;
    const holdSec = ex.currentReps || "";
    const logDate = state.workoutView?.dayId === day.id && state.workoutView?.date
      ? state.workoutView.date
      : (jumpTo?.dayId === day.id ? jumpTo.date : todayISO());

    const exLogs = state.clientData.progress?.exerciseLogs?.[ex.id] || [];
    const todayLog = exLogs.find((l) => l.date === logDate);
    const rounds = Array.from({ length: numRounds }, (_, i) => !!(todayLog?.rounds?.[i]));
    const allDone = () => numRounds > 0 && rounds.every(Boolean);

    const wrapper = document.createElement("div");
    wrapper.className = "cex-wrapper cex-mobility" + (allDone() ? " logged" : "");
    wrapper.dataset.week = week.id;
    wrapper.dataset.day = day.id;

    const row = document.createElement("div");
    row.className = "cex-row";

    const doneCircle = document.createElement("div");
    doneCircle.className = "cex-circle" + (allDone() ? " done" : "");
    doneCircle.textContent = allDone() ? "✓" : "";

    const content = document.createElement("div");
    content.className = "cex-content";

    const line = document.createElement("div");
    line.className = "cex-mob-line";

    const nameEl = document.createElement("span");
    nameEl.className = "cex-name";
    nameEl.textContent = exerciseDisplayLabel(ex);
    line.appendChild(nameEl);

    const rx = document.createElement("span");
    rx.className = "cex-mob-rx";
    rx.textContent = numRounds ? `${numRounds} × ${holdSec ? holdSec + "s" : "hold"}` : "—";
    line.appendChild(rx);

    // Fill line at the bottom of the card — rounds ticked / rounds prescribed.
    const mobBar = document.createElement("div");
    mobBar.className = "cex-progress-line";
    const mobBarFill = document.createElement("div");
    mobBarFill.className = "cex-progress-fill";
    mobBar.appendChild(mobBarFill);
    const mobProgress = () => ({ done: rounds.filter(Boolean).length, total: numRounds });
    const updateMobBar = () => {
      const { done, total } = mobProgress();
      const pct = total ? Math.min(100, Math.round((done / total) * 100)) : 0;
      mobBarFill.style.width = pct + "%";
      mobBar.classList.toggle("complete", pct >= 100);
      updateDayProgressBar();
    };

    const persist = () => {
      const store = state.clientData.progress.exerciseLogs || (state.clientData.progress.exerciseLogs = {});
      if (!rounds.some(Boolean)) {
        if (store[ex.id]) store[ex.id] = store[ex.id].filter((l) => l.date !== logDate);
      } else {
        if (!store[ex.id]) store[ex.id] = [];
        const arr = store[ex.id];
        const idx = arr.findIndex((l) => l.date === logDate);
        const entry = { id: idx >= 0 ? arr[idx].id : uid(), date: logDate, rounds: [...rounds], locked: allDone() };
        if (idx >= 0) arr[idx] = entry; else arr.push(entry);
      }
      saveClient();
      const done = allDone();
      doneCircle.classList.toggle("done", done);
      doneCircle.textContent = done ? "✓" : "";
      wrapper.classList.toggle("logged", done);
      updateMobBar();
      autoSyncDayCompletion(day);
      renderAthleteCalendar();
      if (state.workoutView?.mode === "detail" && state.workoutView.dayId === day.id) {
        renderWorkoutDetailHeader(week, day);
      }
    };

    if (numRounds) {
      const checks = document.createElement("div");
      checks.className = "cex-mob-checks";
      for (let i = 0; i < numRounds; i++) {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "cex-mob-check" + (rounds[i] ? " on" : "");
        b.textContent = rounds[i] ? "✓" : "";
        b.title = `Round ${i + 1}`;
        b.addEventListener("click", (e) => {
          e.stopPropagation();
          rounds[i] = !rounds[i];
          b.classList.toggle("on", rounds[i]);
          b.textContent = rounds[i] ? "✓" : "";
          persist();
        });
        checks.appendChild(b);
      }
      line.appendChild(checks);
    }

    content.appendChild(line);
    row.appendChild(doneCircle);
    row.appendChild(content);
    wrapper.appendChild(row);

    // Coach note + demos (video link and/or photos), if any.
    const mobDemoBtn = demoButton(ex);
    if (ex.notes || ex.videoUrl || mobDemoBtn) {
      const panel = document.createElement("div");
      panel.className = "cex-panel cex-mob-panel";
      if (ex.notes) {
        const notesEl = document.createElement("div");
        notesEl.className = "cex-coach-note";
        notesEl.textContent = ex.notes;
        panel.appendChild(notesEl);
      }
      const ytId = getYouTubeId(ex.videoUrl);
      if (ytId || ex.videoUrl || mobDemoBtn) {
        const demoRow = document.createElement("div");
        demoRow.className = "cex-demo-row";
        if (ytId || ex.videoUrl) {
          const vBtn = document.createElement("button");
          vBtn.className = "btn btn-sm btn-ghost";
          vBtn.textContent = "▶ Watch demo";
          vBtn.addEventListener("click", (e) => {
            e.stopPropagation();
            if (ytId) openVideoModal(ytId, ex.name || "Stretch");
            else window.open(ex.videoUrl, "_blank", "noopener");
          });
          demoRow.appendChild(vBtn);
        }
        if (mobDemoBtn) demoRow.appendChild(mobDemoBtn);
        panel.appendChild(demoRow);
      }
      wrapper.appendChild(panel);
    }

    if (numRounds) {
      wrapper.appendChild(mobBar);
      updateMobBar();
      if (state.workoutView?.mode === "detail" && state.workoutView.dayId === day.id) {
        registerDayProgress(mobProgress);
      }
    }

    return wrapper;
  }

  function renderClientExercise(week, day, ex, jumpTo) {
    if (ex.kind === "mobility") return renderClientMobility(week, day, ex, jumpTo);
    if (!ex.modifiers) ex.modifiers = [];
    // Carries log weight × time — the reps column reads as seconds ("40s").
    const isTimed = exIsTimed(ex);
    const tS = isTimed ? "s" : "";
    // Dumbbell weights read as a pair ("80s"); everything else keeps " lb".
    const dbS = isDumbbellLift(ex.name) ? "s" : "";
    const withT = (v) => (isTimed && /^\d+(\.\d+)?$/.test(String(v)) ? v + "s" : v);
    const logs = state.clientData.progress?.exerciseLogs?.[ex.id] || [];
    const isDone = hasAnyLog(ex);
    // The date being logged right now — needed up here so the "Last:" line can
    // exclude today's in-progress entry.
    const logDate = state.workoutView?.dayId === day.id && state.workoutView?.date
      ? state.workoutView.date
      : (jumpTo?.dayId === day.id ? jumpTo.date : todayISO());
    // "Last:" = the previous SESSION of this exercise — the most recent
    // completed (locked; legacy entries pass) log from any copy of this
    // exercise across the program (matched by name, like progression does),
    // strictly before the date being logged. Never today's own numbers.
    const lastLog = (() => {
      const name = String(ex.name || "").trim().toLowerCase();
      const logsMap = state.clientData.progress?.exerciseLogs || {};
      const candidates = [];
      // One-off coach sessions compare against other one-off sessions only,
      // and program days against the program — a heavy gym day must never
      // become the "Last:" reference for the athlete's solo running program.
      const dayPool = week.id === "oneoff"
        ? [{ days: state.clientData.program?.client?.oneOffDays || [] }]
        : (state.clientData.program?.client?.weeks || []);
      for (const w of dayPool) {
        for (const d of w.days || []) {
          for (const e of d.exercises || []) {
            if (String(e.name || "").trim().toLowerCase() !== name) continue;
            (logsMap[e.id] || []).forEach((l) => {
              if (l.locked === false || l.skipped || String(l.date) >= logDate) return;
              // Skipped sets aren't real numbers — show only what was lifted.
              const sets = Array.isArray(l.sets) ? l.sets.filter((s) => !s.skipped) : [];
              if (sets.length || l.reps) candidates.push({ ...l, sets });
            });
          }
        }
      }
      return candidates.sort((a, b) => String(b.date).localeCompare(String(a.date)))[0] || null;
    })();
    // Pyramid ladder: per-set weight (and optional descending reps) targets.
    // A pyramid overrides auto-progression — one scheme drives the card.
    const pyrW = pyramidWeights(ex, parseInt(ex.sets, 10) || 0);
    const pyrR = pyrW ? pyramidReps(ex, parseInt(ex.sets, 10) || 0) : null;
    // Auto-progression: effective target computed from prior weeks' locked
    // logs (chain of earned increments). Null when the exercise has no rule.
    const prog = pyrW ? null : effectiveProgression(state.clientData.program?.client?.weeks, ex, state.clientData.progress?.exerciseLogs);
    // True when this exercise logs reps only (no weight): a plain BW lift, or a
    // BW-graduating lift still in its bodyweight phase. Once it graduates
    // (prog.bw === false) the athlete logs real weight, so steppers/seeds return.
    const repsOnlyLog = prog ? !!prog.bw : ex.currentWeight === "BW";

    const wrapper = document.createElement("div");
    wrapper.className = "cex-wrapper" + (isDone ? " logged" : "");
    if (pyrW) wrapper.classList.add("pyramid-tint");
    wrapper.dataset.week = week.id;
    wrapper.dataset.day = day.id;

    // ── Compact row ──
    const row = document.createElement("div");
    row.className = "cex-row";

    const doneCircle = document.createElement("div");
    doneCircle.className = "cex-circle" + (isDone ? " done" : "");
    doneCircle.textContent = isDone ? "✓" : "";

    const content = document.createElement("div");
    content.className = "cex-content";

    const nameBlock = document.createElement("div");
    nameBlock.className = "cex-name-block";

    const nameEl = document.createElement("span");
    nameEl.className = "cex-name";
    nameEl.textContent = exerciseDisplayLabel(ex);
    nameBlock.appendChild(nameEl);

    content.appendChild(nameBlock);

    const rxEl = document.createElement("div");
    rxEl.className = "cex-rx";
    const rxParts = [];
    if (ex.sets) rxParts.push(ex.sets + " sets");
    if (pyrW) {
      // The whole ladder when it fits, first→last when it doesn't.
      const s = usesDumbbellPair(ex) ? "s" : " lb";
      rxParts.push((pyrW.length <= 4 ? pyrW.join("→") : `${pyrW[0]}→${pyrW[pyrW.length - 1]}`) + s);
      if (pyrR) rxParts.push("× " + (pyrR[0] === pyrR[pyrR.length - 1] ? withT(String(pyrR[0])) : pyrR.join("/")));
    } else if (prog) {
      // Effective target: computed weight + this week's rep target (climbs
      // toward the ceiling as prior weeks are hit; "+" = beat it if you can).
      // Bodyweight ladders have no weight leg — just BW and the moving reps.
      rxParts.push(prog.bw ? "BW" : (prog.graduate ? "+" : "") + exWeightLabel(ex, String(prog.weight)));
      rxParts.push(`× ${prog.reps}${tS}+`);
    } else {
      // Single prescribed weight (the old upper/range display was retired
      // 2026-07-15 along with the coach-side range picker).
      if (ex.currentWeight) rxParts.push(exWeightLabel(ex, ex.currentWeight));
      if (ex.currentReps) rxParts.push("× " + withT(ex.currentReps));
    }
    const rxMain = document.createElement("span");
    rxMain.className = "cex-rx-main";
    rxMain.textContent = rxParts.join(" · ") || "—";
    if (prog) rxMain.title = prog.bw
      ? (prog.graduate
          ? `Bodyweight rep ladder: hit every set at the target and next week asks for your worst set + 1, up to ${prog.ceil}. Hit ${prog.ceil} on all sets and it graduates — add ${prog.inc} lb, reps reset to ${prog.reset}.`
          : `Rep ladder: hit every set at the target and next week asks for your worst set + 1${prog.ceil === PROG_NO_CAP ? "" : `, up to ${prog.ceil}`}. No weight added.`)
      : prog.repsOnly
        ? `Rep ladder ${prog.floor}→${prog.ceil}: hit every set at the target and next week asks for your worst set + 1, up to ${prog.ceil}. The weight stays at ${prog.weight} lb.`
        : `Double progression ${prog.floor}–${prog.ceil}: hit every set at the target to move up a rep next week; hit ${prog.ceil} on all sets and the weight goes up ${prog.inc} lb (reps drop to ${prog.reset}).`;
    rxEl.appendChild(rxMain);

    if (pyrW) {
      const chip = document.createElement("span");
      chip.className = "cex-pyr-chip";
      chip.textContent = `🔺 +${ex.pyramid.pct}%`;
      chip.title = "Pyramid: the weight climbs each set. " + pyrW.map((w, i) => `${w}${pyrR ? "×" + pyrR[i] : ""}`).join(" → ");
      rxEl.appendChild(chip);
    }

    if (prog && prog.earned > 0) {
      const chip = document.createElement("span");
      chip.className = "cex-prog-chip";
      chip.textContent = `📈 +${Math.round(prog.earned * prog.inc * 100) / 100} lb`;
      chip.title = "Auto-progression: you hit the rep ceiling on every set, so the target went up";
      rxEl.appendChild(chip);
    }

    if (lastLog) {
      const ll = document.createElement("span");
      ll.className = "cex-last-log";
      if (lastLog.sets?.length) {
        // All working sets from the previous session. One weight → "135 lb × 9, 9, 8";
        // mixed weights → "135×9 · 130×8".
        const wts = [...new Set(lastLog.sets.map((s) => s.weight || "BW"))];
        ll.textContent = wts.length === 1
          ? `Last: ${wts[0] === "BW" ? "BW" : wts[0] + (dbS || " lb")} × ${lastLog.sets.map((s) => (s.reps ? s.reps + tS : "?")).join(", ")}`
          : `Last: ${lastLog.sets.map((s) => `${s.weight ? s.weight + dbS : "BW"}×${s.reps ? s.reps + tS : "?"}`).join(" · ")}`;
      } else {
        ll.textContent = `Last: ${lastLog.weight ? lastLog.weight + (dbS || " lb") : "BW"} × ${lastLog.reps ? lastLog.reps + tS : "?"}`;
      }
      ll.title = `Previous session (${lastLog.date})`;
      rxEl.appendChild(ll);
    }

    content.appendChild(rxEl);

    // Left rail: the coach's intensity cue (flames only, no words) sitting
    // right above the done-check that fills in when the exercise is completed.
    const leftCol = document.createElement("div");
    leftCol.className = "cex-left";
    const effortMeta = effortLevel(ex);
    if (effortMeta) {
      applyEffortWrapper(wrapper, ex);
      const tag = document.createElement("span");
      tag.className = "effort-tag flames-only";
      tag.style.setProperty("--effort-rgb", effortMeta.rgb);
      tag.textContent = effortMeta.flames;
      tag.title = effortMeta.label + " intensity";
      leftCol.appendChild(tag);
    }
    leftCol.appendChild(doneCircle);
    row.appendChild(leftCol);
    row.appendChild(content);
    // Lock/Edit control lives at the top-right of the title; the buttons are
    // built later (only when the exercise has sets) and dropped in here.
    const lockSlot = document.createElement("div");
    lockSlot.className = "cex-lock-slot";
    row.appendChild(lockSlot);

    // ── Panel (always open) ──
    const panel = document.createElement("div");
    panel.className = "cex-panel";

    if (ex.notes) {
      const notesEl = document.createElement("div");
      notesEl.className = "cex-coach-note";
      notesEl.textContent = ex.notes;
      panel.appendChild(notesEl);
    }

    const ytId = getYouTubeId(ex.videoUrl);
    const demoBtn = demoButton(ex);
    if (ytId || ex.videoUrl || demoBtn) {
      const demoRow = document.createElement("div");
      demoRow.className = "cex-demo-row";
      if (ytId || ex.videoUrl) {
        const vBtn = document.createElement("button");
        vBtn.className = "btn btn-sm btn-ghost";
        vBtn.textContent = "▶ Watch demo";
        vBtn.addEventListener("click", (e) => {
          e.stopPropagation();
          if (ytId) openVideoModal(ytId, ex.name || "Exercise");
          else window.open(ex.videoUrl, "_blank", "noopener");
        });
        demoRow.appendChild(vBtn);
      }
      if (demoBtn) demoRow.appendChild(demoBtn);
      panel.appendChild(demoRow);
    }

    // Log form (logDate computed at the top of the function)
    const logForm = document.createElement("div");
    logForm.className = "cex-log-form";

    const numSets = parseInt(ex.sets) || 0;
    // With a progression rule, placeholders/seeds use the computed target.
    // DB-pair exercises read plural ("50s") in placeholders, matching the rx.
    const pairS = usesDumbbellPair(ex) ? "s" : "";
    const wtPh = prog && !prog.bw ? prog.weight + pairS : (ex.currentWeight && ex.currentWeight !== "BW" ? ex.currentWeight + pairS : "");
    const repPh = prog ? `${prog.reps}${tS}+` : (ex.currentReps ? withT(ex.currentReps) : "");

    // Header row
    const setTable = document.createElement("div");
    setTable.className = "cex-set-table";

    // Per-exercise fill line (bottom edge of the card) + day-bar registration.
    let exBar = null, exProgress = null, updateExBar = () => {};

    if (!numSets) {
      setTable.innerHTML = `<p class="cex-no-sets">Sets not prescribed yet. Your coach will fill this in.</p>`;
      logForm.appendChild(setTable);
    } else {
    const todayLog = logs.find(l => l.date === logDate);
    // Locked when this date's entry is locked — or when the exercise reads
    // "done" from a session on another date (the card shows a green ✓ from
    // hasAnyLog, so the control must be Edit, not a dead-end lock button).
    let isLocked = isLogEntryLocked(todayLog, ex, numSets) || (!todayLog && hasAnyLog(ex));

    // Prescribed reps/weight seed the per-field steppers when a field is empty.
    const prescribedReps = prog ? prog.reps : parseInt(ex.currentReps, 10);
    const weightBase = prog && !prog.bw ? prog.weight : weightToLb(ex.currentWeight); // "BAR" → 45
    // Per-set targets: pyramid columns each have their own number, everything
    // else is flat across the sets.
    const wSeedAt = (i) => (pyrW ? pyrW[i] : weightBase);
    const rSeedAt = (i) => (pyrR ? pyrR[i] : prescribedReps);

    const setInputs = [];
    // Per-field steppers: tap ▼ / ▲ to nudge a set's weight (±2.5 lb) or reps
    // (±1). Empty fields seed from the prescription so the first tap lands on a
    // sensible number instead of 0. Collected so they disable when locked.
    const setSteppers = [];
    // Card fill line: fraction of working sets filled in (or skipped).
    // Locked cards read full.
    const setDoneNow = (it) => it.skipped || (it.rp.value && (it.wt.value || repsOnlyLog));
    // Warm-ups count toward the fill line too — they're required to lock, so
    // the bar shouldn't read full while they're still empty. (warmupInputs is
    // declared below but only read at call time, after the card is built.)
    exProgress = () => {
      const wTotal = warmupInputs.length;
      if (isLocked) return { done: numSets + wTotal, total: numSets + wTotal };
      const wDone = warmupInputs.filter((it, i) =>
        it.rp.value && (it.wt.value || repsOnlyLog || warmups[i]?.weight === "BW")).length;
      return { done: setInputs.filter(setDoneNow).length + wDone, total: numSets + wTotal };
    };
    exBar = document.createElement("div");
    exBar.className = "cex-progress-line";
    const exBarFill = document.createElement("div");
    exBarFill.className = "cex-progress-fill";
    exBar.appendChild(exBarFill);
    updateExBar = () => {
      const { done, total } = exProgress();
      const pct = total ? Math.min(100, Math.round((done / total) * 100)) : 0;
      exBarFill.style.width = pct + "%";
      exBar.classList.toggle("complete", pct >= 100);
      updateDayProgressBar();
    };
    // Values that are actually filled in (typed, stepped, tapped-to-accept, or
    // restored from today's draft) render in the edited tint, so it's obvious
    // at a glance which fields hold real numbers vs. placeholder targets.
    const markEdited = (input) => input.classList.toggle("edited", input.value !== "");
    // Editing either field of a set accepts the prescription in its sibling,
    // so one touch per set is enough when the athlete did what was written.
    const fillSibling = (other, seed) => {
      if (other.readOnly || other.value !== "" || !Number.isFinite(seed)) return;
      other.value = String(seed);
      markEdited(other);
    };
    // Build a field as ▲ (top) / input / ▼ (bottom). Steppers omitted when
    // withSteppers is false (e.g. the weight box on bodyweight lifts).
    // onUserEdit fires on any deliberate touch (step / tap-to-accept).
    const mkStepField = (input, step, seed, withSteppers, onUserEdit) => {
      const field = document.createElement("div");
      field.className = "cex-set-field";
      const mkBtn = (glyph, dir) => {
        const b = document.createElement("button");
        b.type = "button";
        b.className = "cex-step";
        b.textContent = glyph;
        b.title = `${dir > 0 ? "+" : "−"}${step}`;
        b.addEventListener("click", (e) => {
          e.stopPropagation();
          if (input.readOnly) return;
          let cur = input.value !== "" ? parseFloat(input.value) : seed;
          if (!Number.isFinite(cur)) cur = 0;
          let v = Math.max(0, cur + dir * step);
          v = Math.round(v * 100) / 100; // trim float dust (e.g. 0.1 + 0.2)
          input.value = String(v);
          delete input.dataset.seeded; // stepped value is deliberate — typing shouldn't wipe it
          markEdited(input);
          onUserEdit?.();
          autoSave();
        });
        setSteppers.push(b);
        return b;
      };
      if (withSteppers) field.appendChild(mkBtn("▲", 1));
      field.appendChild(input);
      if (withSteppers) field.appendChild(mkBtn("▼", -1));
      // Tapping an empty field accepts the prescription: the placeholder value
      // becomes the real value, so clicking off keeps it — no typing needed
      // when the athlete did exactly what was prescribed. No select() — the
      // selection callout (Cut/Copy) on mobile can't be suppressed, so the
      // first keystroke on a just-seeded field clears it instead, giving the
      // same type-to-replace feel without any selection.
      input.addEventListener("focus", () => {
        if (input.readOnly) return;
        if (input.value === "" && Number.isFinite(seed)) {
          input.value = String(seed);
          input.dataset.seeded = "1";
          markEdited(input);
          onUserEdit?.();
          autoSave();
        }
      });
      input.addEventListener("beforeinput", () => {
        if (input.dataset.seeded) { delete input.dataset.seeded; input.value = ""; }
      });
      input.addEventListener("blur", () => { delete input.dataset.seeded; markEdited(input); });
      return field;
    };

    // Warm-up columns (optional, up to 2) render before the working sets, tinted
    // and labeled W1/W2. When present they're part of completing the card —
    // required to lock, same as working sets.
    const warmupInputs = []; // { wt, rp }
    const warmups = (ex.warmups || []).slice(0, 3);
    warmups.forEach((w, i) => {
      const col = document.createElement("div");
      col.className = "cex-set-col cex-warm-col" + (i === warmups.length - 1 ? " cex-warm-last" : "");

      const lbl = document.createElement("span");
      lbl.className = "cex-set-lbl";
      lbl.textContent = `W${i + 1}`;

      const wSeed = weightToLb(w.weight); // "BAR" → 45
      const rSeed = parseInt(w.reps, 10);
      const wPh = w.weight === "BAR" ? "BAR" : (w.weight && w.weight !== "BW") ? w.weight + pairS : "lb";
      const wt = Object.assign(document.createElement("input"), { type: "number", step: "0.5", min: "0", placeholder: wPh, readOnly: isLocked });
      const rp = Object.assign(document.createElement("input"), { type: "number", min: "0", placeholder: w.reps ? withT(w.reps) : (isTimed ? "sec" : "reps"), readOnly: isLocked });
      wt.className = "cex-input"; rp.className = "cex-input";
      wt.addEventListener("click", (e) => e.stopPropagation());
      rp.addEventListener("click", (e) => e.stopPropagation());
      wt.addEventListener("input", () => { markEdited(wt); fillSibling(rp, rSeed); });
      rp.addEventListener("input", () => { markEdited(rp); fillSibling(wt, wSeed); });

      col.appendChild(lbl);
      col.appendChild(mkStepField(wt, 2.5, wSeed, w.weight !== "BW", () => fillSibling(rp, rSeed)));
      col.appendChild(mkStepField(rp, isTimed ? 5 : 1, rSeed, true, () => fillSibling(wt, wSeed)));

      setTable.appendChild(col);
      warmupInputs.push({ wt, rp });
    });

    for (let s = 0; s < numSets; s++) {
      const col = document.createElement("div");
      col.className = "cex-set-col";

      // Set label. Skipping is handled from the Tools menu ("Skip last N sets"),
      // not by tapping the label — this is just the S1/S2… marker, which gains
      // an ⊘ when its set is skipped.
      const lbl = document.createElement("span");
      lbl.className = "cex-set-lbl";
      lbl.textContent = `S${s + 1}`;

      const wt = Object.assign(document.createElement("input"), { type: "number", step: "0.5", min: "0", placeholder: pyrW ? pyrW[s] + pairS : (wtPh || "lb"), readOnly: isLocked });
      const rp = Object.assign(document.createElement("input"), { type: "number", min: "0", placeholder: pyrR ? withT(String(pyrR[s])) : (repPh || (isTimed ? "sec" : "reps")), readOnly: isLocked });
      wt.className = "cex-input"; rp.className = "cex-input";
      wt.addEventListener("click", (e) => e.stopPropagation());
      rp.addEventListener("click", (e) => e.stopPropagation());
      wt.addEventListener("input", () => { markEdited(wt); fillSibling(rp, rSeedAt(s)); });
      rp.addEventListener("input", () => { markEdited(rp); fillSibling(wt, wSeedAt(s)); });

      const item = { wt, rp, skipped: false };
      item.applySkip = () => {
        col.classList.toggle("skipped", item.skipped);
        lbl.innerHTML = item.skipped ? `S${s + 1}<span class="cex-skip-mark">⊘</span>` : `S${s + 1}`;
        lbl.title = item.skipped ? "Skipped" : "";
        wt.disabled = item.skipped; rp.disabled = item.skipped;
      };

      col.appendChild(lbl);
      // Weight field, ±2.5 lb (bodyweight lifts log reps only — no weight arrows).
      col.appendChild(mkStepField(wt, 2.5, wSeedAt(s), !repsOnlyLog, () => fillSibling(rp, rSeedAt(s))));
      // Reps field, ±1 (carries count seconds, ±5).
      col.appendChild(mkStepField(rp, isTimed ? 5 : 1, rSeedAt(s), true, () => fillSibling(wt, wSeedAt(s))));

      setTable.appendChild(col);
      setInputs.push(item);
    }

    // Pre-fill today's existing log so edits persist
    if (todayLog?.sets?.length) {
      todayLog.sets.forEach((s, i) => {
        if (!setInputs[i]) return;
        if (s.skipped) { setInputs[i].skipped = true; setInputs[i].applySkip(); }
        else { setInputs[i].wt.value = s.weight || ""; setInputs[i].rp.value = s.reps || ""; }
      });
    }
    if (todayLog?.warmups?.length) {
      todayLog.warmups.forEach((w, i) => {
        if (warmupInputs[i]) { warmupInputs[i].wt.value = w.weight || ""; warmupInputs[i].rp.value = w.reps || ""; }
      });
    }
    [...setInputs, ...warmupInputs].forEach(({ wt, rp }) => { markEdited(wt); markEdited(rp); });

    // Finisher slots (burnout / dropset). Weight is the drop-to % of the
    // prescribed weight (computed, shown as a target); the athlete logs reps.
    const finisherInputs = []; // { kind, dropIdx, pct, target, rp }
    const finisherWrap = document.createElement("div");
    finisherWrap.className = "cex-finisher-wrap";
    const addFinisherSlot = (kind, dropIdx, label, pct) => {
      // Drop % computes off the effective (progressed) weight when a rule is set.
      const target = finisherDropWeight(prog && !prog.bw ? String(prog.weight) : ex.currentWeight, pct);
      const wtTxt = target != null ? ` · ${target} lb` : (ex.currentWeight === "BW" ? " · BW" : "");
      const fr = document.createElement("div");
      fr.className = "cex-finisher-row";
      const lbl = document.createElement("span");
      lbl.className = "cex-finisher-lbl";
      lbl.innerHTML = `${label} <span class="cex-finisher-pct">${pct}%${wtTxt}</span>`;
      const rp = Object.assign(document.createElement("input"), { type: "number", min: "0", placeholder: "reps", readOnly: isLocked });
      rp.className = "cex-input cex-finisher-input";
      rp.addEventListener("click", (e) => e.stopPropagation());
      fr.appendChild(lbl); fr.appendChild(rp);
      finisherWrap.appendChild(fr);
      finisherInputs.push({ kind, dropIdx, pct, target, rp });
    };
    if (ex.burnout?.pct) addFinisherSlot("burnout", null, "🔥 Burnout", ex.burnout.pct);
    if (ex.dropset?.pcts?.length) ex.dropset.pcts.forEach((p, i) => addFinisherSlot("dropset", i, `⬇ Drop ${i + 1}`, p));

    if (todayLog?.burnout) {
      const b = finisherInputs.find((f) => f.kind === "burnout");
      if (b) b.rp.value = todayLog.burnout.reps || "";
    }
    if (Array.isArray(todayLog?.dropset)) {
      todayLog.dropset.forEach((d, i) => {
        const f = finisherInputs.find((x) => x.kind === "dropset" && x.dropIdx === i);
        if (f) f.rp.value = d.reps || "";
      });
    }

    const collectFinishers = () => {
      const out = {};
      const b = finisherInputs.find((f) => f.kind === "burnout");
      if (b) out.burnout = { pct: b.pct, weight: b.target, reps: b.rp.value };
      const drops = finisherInputs.filter((f) => f.kind === "dropset");
      if (drops.length) out.dropset = drops.map((d) => ({ pct: d.pct, weight: d.target, reps: d.rp.value }));
      return out;
    };
    const finisherHasData = () => finisherInputs.some((f) => f.rp.value);
    const finisherComplete = () => finisherInputs.every((f) => f.rp.value);
    const warmupHasData = () => warmupInputs.some(({ wt, rp }) => wt.value || rp.value);
    // A warm-up slot is done once reps are in (weight too, unless the lift is
    // reps-only or the slot is prescribed as BW).
    const warmupComplete = () => warmupInputs.every(({ wt, rp }, i) =>
      rp.value && (wt.value || repsOnlyLog || warmups[i]?.weight === "BW"));
    const collectWarmups = () => {
      const arr = warmupInputs.map(({ wt, rp }) => ({ weight: wt.value, reps: rp.value }));
      return arr.some((w) => w.weight || w.reps) ? { warmups: arr } : {};
    };

    // Auto-save: debounced 800ms after last keystroke, saves a draft entry.
    // Drafts never lock in the green checkmark — only the Lock button does.
    let _ast = null;
    // Auto-lock runs on its own, slower fuse (below) so there's time to fix a
    // number on the last set before the card closes up.
    let _alt = null;
    const AUTOLOCK_MS = 4000;
    // Once the athlete unlocks with ✎ Edit, auto-lock stays off for this
    // card — relocking is theirs to do with 🔒.
    let manualUnlock = false;
    const autoSave = () => {
      refreshToolsState(); // values are already current — keep ⌫ Clear in sync live
      updateExBar();     // ...and the card/day progress fills too
      clearTimeout(_ast);
      clearTimeout(_alt);
      if (!isLocked && !manualUnlock) {
        _alt = setTimeout(() => { if (!isLocked && !manualUnlock) lockIn({ silent: true }); }, AUTOLOCK_MS);
      }
      _ast = setTimeout(() => {
        const sets = setInputs.map(({ wt, rp, skipped }) => (skipped ? { weight: "", reps: "", skipped: true } : { weight: wt.value, reps: rp.value }))
                              .filter(s => s.skipped || s.weight || s.reps);
        if (!sets.length && !finisherHasData() && !warmupHasData()) {
          if (state.clientData.progress.exerciseLogs[ex.id]) {
            state.clientData.progress.exerciseLogs[ex.id] =
              state.clientData.progress.exerciseLogs[ex.id].filter(l => l.date !== logDate);
          }
          saveClient();
          renderAthleteCalendar();
          return;
        }
        if (!state.clientData.progress.exerciseLogs[ex.id])
          state.clientData.progress.exerciseLogs[ex.id] = [];
        const exLogs = state.clientData.progress.exerciseLogs[ex.id];
        const idx = exLogs.findIndex(l => l.date === logDate);
        const entry = { id: idx >= 0 ? exLogs[idx].id : uid(), date: logDate, sets, locked: false, ...collectWarmups(), ...collectFinishers() };
        if (idx >= 0) exLogs[idx] = entry; else exLogs.push(entry);
        saveClient();
        renderAthleteCalendar();
      }, 800);
    };
    setInputs.forEach(({ wt, rp }) => {
      wt.addEventListener("input", autoSave);
      rp.addEventListener("input", autoSave);
    });
    warmupInputs.forEach(({ wt, rp }) => {
      wt.addEventListener("input", autoSave);
      rp.addEventListener("input", autoSave);
    });
    finisherInputs.forEach(({ rp }) => rp.addEventListener("input", () => { markEdited(rp); autoSave(); }));
    finisherInputs.forEach(({ rp }) => markEdited(rp)); // pre-filled finisher reps tint too

    // Lock / Edit toggle — lives in the title's lock slot (top-right). The
    // green ✓ only fills in once the athlete explicitly locks completed sets.
    const lockBtn = document.createElement("button");
    lockBtn.type = "button";
    lockBtn.className = "btn btn-primary btn-sm cex-lock-btn";
    lockBtn.textContent = "🔒";
    lockBtn.title = "Lock in";

    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.className = "cex-edit-btn";
    editBtn.textContent = "✎ Edit";

    // ── Tools menu ── one quiet title-area button gathering the escape hatches:
    // skip the last N sets, skip the whole exercise, or clear today's numbers.
    // Replaces the old standalone ⊘ Skip / ⌫ Clear buttons. The popover is
    // rendered to <body> (position:fixed) so the card's overflow:hidden can't
    // clip it, and is anchored to the button on open.
    const draftHasData = () =>
      setInputs.some((it) => it.skipped || it.wt.value || it.rp.value) || warmupHasData() || finisherHasData();

    const toolsWrap = document.createElement("div");
    toolsWrap.className = "cex-tools-wrap";
    const toolsBtn = document.createElement("button");
    toolsBtn.type = "button";
    toolsBtn.className = "cex-tools-btn";
    // Lucide "wrench" (same inlined line-icon set as the nav / day-icon picker).
    toolsBtn.innerHTML = '<svg class="cex-tools-ico" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M14.7 6.3a1 1 0 0 0 0 1.4l1.6 1.6a1 1 0 0 0 1.4 0l3.77-3.77a6 6 0 0 1-7.94 7.94l-6.91 6.91a2.12 2.12 0 0 1-3-3l6.91-6.91a6 6 0 0 1 7.94-7.94l-3.76 3.76z"/></svg><span>Tools</span>';
    toolsBtn.title = "Skip sets, skip the exercise, or clear your numbers";
    toolsBtn.setAttribute("aria-haspopup", "true");
    toolsBtn.setAttribute("aria-expanded", "false");
    toolsWrap.appendChild(toolsBtn);

    const toolsMenu = document.createElement("div");
    toolsMenu.className = "cex-tools-menu hidden";

    // Skip last N sets: X's out the highest-numbered sets. Governs the trailing
    // block only, so a per-set label tap in the middle is left untouched.
    let bulkN = 0;
    const setSkip = (item, val) => { if (item.skipped !== val) { item.skipped = val; item.applySkip(); } };
    const trailingSkipCount = () => {
      let n = 0;
      for (let i = numSets - 1; i >= 0 && setInputs[i].skipped; i--) n++;
      return n;
    };
    const skipCount = document.createElement("span");
    skipCount.className = "cex-tools-count";
    skipCount.textContent = "0";
    const applyBulkSkip = (n) => {
      n = Math.max(0, Math.min(numSets, n));
      for (let i = 0; i < numSets; i++) {
        if (i >= numSets - n) setSkip(setInputs[i], true);
        else if (i >= numSets - bulkN) setSkip(setInputs[i], false); // released as N shrank
      }
      bulkN = n;
      skipCount.textContent = String(n);
      updateExBar();
      autoSave();
      refreshToolsState();
    };
    const mkSkipStep = (glyph, delta) => {
      const b = document.createElement("button");
      b.type = "button";
      b.className = "cex-tools-step";
      b.textContent = glyph;
      b.addEventListener("click", (e) => { e.stopPropagation(); applyBulkSkip(bulkN + delta); });
      return b;
    };
    const skipRow = document.createElement("div");
    skipRow.className = "cex-tools-skiprow";
    const skipLbl = document.createElement("span");
    skipLbl.className = "cex-tools-skiplbl";
    skipLbl.textContent = "Skip last";
    const skipUnit = document.createElement("span");
    skipUnit.className = "cex-tools-skipunit";
    skipUnit.textContent = "sets";
    skipRow.append(skipLbl, mkSkipStep("−", -1), skipCount, mkSkipStep("+", 1), skipUnit);

    const toolsDiv = document.createElement("div");
    toolsDiv.className = "cex-tools-div";
    const skipExItem = document.createElement("button");
    skipExItem.type = "button";
    skipExItem.className = "cex-tools-item";
    skipExItem.textContent = "⊘ Skip whole exercise";
    const clearItem = document.createElement("button");
    clearItem.type = "button";
    clearItem.className = "cex-tools-item cex-tools-clear";
    clearItem.textContent = "⌫ Clear my numbers";
    toolsMenu.append(skipRow, toolsDiv, skipExItem, clearItem);

    const refreshToolsState = () => { clearItem.disabled = !draftHasData(); };

    function onToolsAway(e) {
      if (e.type === "scroll" || (!toolsMenu.contains(e.target) && !toolsWrap.contains(e.target))) closeToolsMenu();
    }
    const closeToolsMenu = () => {
      if (toolsMenu.classList.contains("hidden")) return;
      toolsMenu.classList.add("hidden");
      toolsMenu.remove();
      toolsBtn.setAttribute("aria-expanded", "false");
      document.removeEventListener("click", onToolsAway, true);
      window.removeEventListener("scroll", onToolsAway, true);
      window.removeEventListener("resize", onToolsAway, true);
    };
    const openToolsMenu = () => {
      bulkN = trailingSkipCount();
      skipCount.textContent = String(bulkN);
      refreshToolsState();
      document.body.appendChild(toolsMenu);
      toolsMenu.classList.remove("hidden");
      toolsBtn.setAttribute("aria-expanded", "true");
      // Anchor under the button, right-aligned, clamped to the viewport.
      const r = toolsBtn.getBoundingClientRect();
      const mw = toolsMenu.offsetWidth, mh = toolsMenu.offsetHeight;
      let left = Math.min(r.right - mw, window.innerWidth - mw - 8);
      left = Math.max(8, left);
      const top = Math.min(r.bottom + 6, window.innerHeight - mh - 8);
      toolsMenu.style.left = left + "px";
      toolsMenu.style.top = Math.max(8, top) + "px";
      document.addEventListener("click", onToolsAway, true);
      window.addEventListener("scroll", onToolsAway, true);
      window.addEventListener("resize", onToolsAway, true);
    };
    toolsBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      if (toolsMenu.classList.contains("hidden")) openToolsMenu(); else closeToolsMenu();
    });

    const applySkippedUI = (on) => {
      wrapper.classList.toggle("skipped", on);
      doneCircle.classList.toggle("skip", on);
      if (on) {
        wrapper.classList.remove("logged");
        doneCircle.classList.remove("done");
        doneCircle.textContent = "⊘";
      } else if (!doneCircle.classList.contains("done")) {
        doneCircle.textContent = "";
      }
    };

    const setFieldsReadonly = (readonly) => {
      setInputs.forEach(({ wt, rp }) => { wt.readOnly = readonly; rp.readOnly = readonly; });
      warmupInputs.forEach(({ wt, rp }) => { wt.readOnly = readonly; rp.readOnly = readonly; });
      finisherInputs.forEach(({ rp }) => { rp.readOnly = readonly; });
      setSteppers.forEach((b) => { b.disabled = readonly; });
    };
    const refreshLockUI = () => {
      hide(isLocked ? lockBtn : editBtn);
      show(isLocked ? editBtn : lockBtn);
      if (isLocked) { hide(toolsWrap); closeToolsMenu(); } else show(toolsWrap);
      refreshToolsState();
      setFieldsReadonly(isLocked);
      updateExBar();
    };

    // Shared by the 🔒 button and the auto-lock below. `seedEmpty` is the
    // manual-tap behaviour (accept the prescription for untouched fields);
    // auto-lock never seeds — it must only fire on what the athlete actually
    // entered, or touching one field would fill in and lock the rest.
    // `silent` suppresses the "fill in all sets" nags for the auto path.
    const lockIn = ({ seedEmpty = false, silent = false } = {}) => {
      if (seedEmpty) {
        setInputs.forEach((it, i) => {
          if (it.skipped) return;
          if (it.rp.value === "" && Number.isFinite(rSeedAt(i))) { it.rp.value = String(rSeedAt(i)); markEdited(it.rp); }
          if (it.wt.value === "" && !repsOnlyLog && Number.isFinite(wSeedAt(i))) { it.wt.value = String(wSeedAt(i)); markEdited(it.wt); }
        });
        // Warm-ups seed from their prescription too, so 🔒 stays one tap
        // when the athlete did exactly what was written.
        warmupInputs.forEach(({ wt, rp }, i) => {
          const ws = weightToLb(warmups[i]?.weight), rs = parseInt(warmups[i]?.reps, 10); // "BAR" → 45
          if (rp.value === "" && Number.isFinite(rs)) { rp.value = String(rs); markEdited(rp); }
          if (wt.value === "" && !repsOnlyLog && Number.isFinite(ws)) { wt.value = String(ws); markEdited(wt); }
        });
      }
      const sets = setInputs.map(({ wt, rp, skipped }) => (skipped ? { weight: "", reps: "", skipped: true } : { weight: wt.value, reps: rp.value }));
      const complete = sets.every((s) => s.skipped || (s.reps && (s.weight || repsOnlyLog)));
      if (!complete) { if (!silent) toast("Fill in all sets before locking in."); return false; }
      if (!warmupComplete()) { if (!silent) toast("Fill in your warm-up sets before locking in."); return false; }
      if (!finisherComplete()) { if (!silent) toast("Fill in your burnout/dropset reps before locking in."); return false; }
      clearTimeout(_ast);
      clearTimeout(_alt);
      manualUnlock = false;
      if (!state.clientData.progress.exerciseLogs[ex.id])
        state.clientData.progress.exerciseLogs[ex.id] = [];
      const exLogs = state.clientData.progress.exerciseLogs[ex.id];
      const idx = exLogs.findIndex(l => l.date === logDate);
      const entry = { id: idx >= 0 ? exLogs[idx].id : uid(), date: logDate, sets, locked: true, ...collectWarmups(), ...collectFinishers() };
      if (idx >= 0) exLogs[idx] = entry; else exLogs.push(entry);
      detectAndCelebratePR(ex, entry, wrapper);
      saveClient();
      renderStrengthProgress($("#athlete-strength-charts"), state.clientData.program?.client, state.clientData.progress);
      if (typeof renderAthletePRs === "function") renderAthletePRs();
      isLocked = true;
      refreshLockUI();
      doneCircle.classList.add("done"); doneCircle.textContent = "✓";
      wrapper.classList.add("logged");
      autoSyncDayCompletion(day);
      if (state.workoutView?.mode === "detail" && state.workoutView.dayId === day.id) {
        renderWorkoutDetailHeader(week, day);
      }
      return true;
    };

    lockBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      lockIn({ seedEmpty: true });
    });

    editBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const exLogs = state.clientData.progress.exerciseLogs[ex.id];
      let entry = exLogs?.find(l => l.date === logDate);
      // Date drift (logged yesterday / coach live-logged another date):
      // unlock the most recent locked session instead of silently doing
      // nothing — otherwise the day-done ✓ can never be cleared from here.
      if (!entry && exLogs?.length) {
        entry = [...exLogs]
          .sort((a, b) => (b.date || "").localeCompare(a.date || ""))
          .find((l) => isLogEntryLocked(l, ex, numSets));
      }
      if (entry) { entry.locked = false; delete entry.skipped; }
      saveClient();
      isLocked = false;
      manualUnlock = true; // deliberate unlock — 🔒 is manual from here on
      clearTimeout(_alt);
      refreshLockUI();
      applySkippedUI(false);
      doneCircle.classList.remove("done"); doneCircle.textContent = "";
      wrapper.classList.remove("logged");
      autoSyncDayCompletion(day);
      if (state.workoutView?.mode === "detail" && state.workoutView.dayId === day.id) {
        renderWorkoutDetailHeader(week, day);
      }
    });

    const doSkipExercise = () => {
      closeToolsMenu();
      const hasData = setInputs.some((it) => !it.skipped && (it.wt.value || it.rp.value)) || warmupHasData() || finisherHasData();
      if (hasData && !window.confirm("Discard the entered numbers and mark this exercise skipped?")) return;
      clearTimeout(_ast);
      clearTimeout(_alt);
      if (!state.clientData.progress.exerciseLogs[ex.id])
        state.clientData.progress.exerciseLogs[ex.id] = [];
      const exLogs = state.clientData.progress.exerciseLogs[ex.id];
      const idx = exLogs.findIndex(l => l.date === logDate);
      const entry = { id: idx >= 0 ? exLogs[idx].id : uid(), date: logDate, sets: [], skipped: true, locked: true };
      if (idx >= 0) exLogs[idx] = entry; else exLogs.push(entry);
      saveClient();
      isLocked = true;
      refreshLockUI();
      applySkippedUI(true);
      autoSyncDayCompletion(day);
      if (state.workoutView?.mode === "detail" && state.workoutView.dayId === day.id) {
        renderWorkoutDetailHeader(week, day);
      }
    };
    skipExItem.addEventListener("click", (e) => { e.stopPropagation(); doSkipExercise(); });

    const doClearDraft = () => {
      closeToolsMenu();
      if (!window.confirm("Clear today's numbers for this exercise?")) return;
      clearTimeout(_ast);
      clearTimeout(_alt);
      const exLogs = state.clientData.progress.exerciseLogs[ex.id];
      if (exLogs) {
        const rest = exLogs.filter((l) => l.date !== logDate);
        if (rest.length) state.clientData.progress.exerciseLogs[ex.id] = rest;
        else delete state.clientData.progress.exerciseLogs[ex.id];
      }
      saveClient();
      // Full re-render resets fields, blue tints, skips and history in one go.
      if (state.workoutView?.mode === "detail") renderWorkoutDetailUI();
      else renderClientWorkouts();
      renderAthleteCalendar();
    };
    clearItem.addEventListener("click", (e) => { e.stopPropagation(); doClearDraft(); });

    lockSlot.appendChild(toolsWrap);
    lockSlot.appendChild(lockBtn);
    lockSlot.appendChild(editBtn);

    refreshLockUI();
    if (todayLog?.skipped && isLocked) applySkippedUI(true);

    logForm.appendChild(setTable);
    if (finisherInputs.length) logForm.appendChild(finisherWrap);
    } // end else (numSets > 0)
    panel.appendChild(logForm);

    // Previous logs (last 3)
    if (logs.length) {
      const hist = document.createElement("div");
      hist.className = "cex-hist";
      [...logs].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 3).forEach((l) => {
        const item = document.createElement("div");
        item.className = "cex-hist-item";
        const setStr = l.skipped
          ? `<span class="cex-hist-set cex-hist-skip">⊘ Skipped</span>`
          : l.sets?.length
          ? l.sets.map((s, i) => s.skipped
              ? `<span class="cex-hist-set cex-hist-skip"><em>S${i+1}</em> ⊘</span>`
              : `<span class="cex-hist-set"><em>S${i+1}</em> ${s.weight ? escapeHtml(s.weight) + dbS : "BW"} × ${escapeHtml(s.reps ? s.reps + tS : "?")}</span>`).join("")
          : `<span class="cex-hist-set">${l.weight ? escapeHtml(l.weight) + (dbS || " lb") : "BW"} × ${escapeHtml(l.reps || "?")} ${isTimed ? "sec" : "reps"}</span>`;
        const dateHtml = l.date === logDate ? "" : `<span class="cex-hist-date">${escapeHtml(l.date)}</span>`;
        item.innerHTML = `${dateHtml}
          <span class="cex-hist-sets">${setStr}</span>
          <button class="cex-del-log" data-lid="${escapeHtml(l.id)}" title="Delete">×</button>`;
        item.querySelector(".cex-del-log").addEventListener("click", (e) => {
          e.stopPropagation();
          if (!window.confirm("Delete this log entry?")) return;
          state.clientData.progress.exerciseLogs[ex.id] =
            state.clientData.progress.exerciseLogs[ex.id].filter((x) => x.id !== l.id);
          saveClient();
          if (state.workoutView?.mode === "detail") renderWorkoutDetailUI();
          else renderClientWorkouts();
          renderAthleteCalendar();
        });
        hist.appendChild(item);
      });
      panel.appendChild(hist);
    }

    wrapper.appendChild(row);
    wrapper.appendChild(panel);
    if (exBar) { wrapper.appendChild(exBar); updateExBar(); }
    // Only cards in the OPEN day feed the floating bar (this renderer also
    // serves the all-weeks view, which must not pollute the day's registry).
    if (exProgress && state.workoutView?.mode === "detail" && state.workoutView.dayId === day.id) {
      registerDayProgress(exProgress);
    }
    return wrapper;
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

  // "none" = the coach explicitly turned the demo off for this exercise.
  function demoForExercise(ex) {
    if (!ex) return null;
    if (ex.demoId === "none") return null;
    if (ex.demoId) return demoIndex().byId.get(ex.demoId) || null;
    return findDemoByName(ex.name);
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

  const DEMO_LEVEL_ICON = { beginner: "●", intermediate: "●●", expert: "●●●" };

  function demoChipsHtml(entry) {
    const chips = [];
    if (entry.e && entry.e !== "other") chips.push(escapeHtml(entry.e));
    if (entry.l) chips.push(`${DEMO_LEVEL_ICON[entry.l] || ""} ${escapeHtml(entry.l)}`.trim());
    for (const m of (entry.p || [])) chips.push(escapeHtml(m));
    if (!chips.length) return "";
    return `<div class="demo-chips">${chips.map((c) => `<span class="demo-chip">${c}</span>`).join("")}</div>`;
  }

  // Two stills (start + finish) cross-faded on a loop, so a still photo reads
  // as a movement. Tap the photo to freeze it on one position.
  let _demoTimer = null;
  function openDemoModal(entry, displayName) {
    if (!entry) return;
    const frames = Math.min(entry.m || 1, 4);
    const imgs = [];
    for (let i = 0; i < frames; i++) {
      imgs.push(`<img class="demo-frame${i === 0 ? " on" : ""}" src="${demoImgUrl(entry.i, i)}" alt="${escapeHtml(entry.n)} position ${i + 1}" loading="lazy" />`);
    }
    const nameLine = displayName && demoTokens(displayName).join(" ") !== demoTokens(entry.n).join(" ")
      ? `<p class="demo-alias muted">Shown: ${escapeHtml(entry.n)}</p>` : "";
    openModal({
      title: displayName || entry.n,
      body: `
        <div class="demo-stage" id="demo-stage">
          ${imgs.join("")}
          ${frames > 1 ? `<span class="demo-hint" id="demo-hint">tap to pause</span>` : ""}
        </div>
        ${nameLine}
        ${demoChipsHtml(entry)}
        <p class="demo-credit muted">Photo: free-exercise-db, public domain</p>`,
      actions: [{ label: "Close", className: "btn btn-ghost", onClick: closeDemoModal }],
    });
    // Never leave a previous demo's timer running — only one demo is ever open,
    // and a stale one would fight the new modal for _demoTimer.
    if (_demoTimer) { clearInterval(_demoTimer); _demoTimer = null; }
    if (frames > 1) {
      const stage = $("#demo-stage");
      const els = Array.from(stage.querySelectorAll(".demo-frame"));
      let at = 0, paused = false;
      // `mine` so a stale tick cancels its own interval rather than whichever
      // one _demoTimer happens to point at now.
      const mine = setInterval(() => {
        // The modal's own ✕ closes without going through closeDemoModal.
        if (!document.body.contains(stage)) {
          clearInterval(mine);
          if (_demoTimer === mine) _demoTimer = null;
          return;
        }
        if (paused) return;
        els[at].classList.remove("on");
        at = (at + 1) % els.length;
        els[at].classList.add("on");
      }, 1100);
      _demoTimer = mine;
      stage.addEventListener("click", () => {
        paused = !paused;
        stage.classList.toggle("is-paused", paused);
        const hint = $("#demo-hint");
        if (hint) hint.textContent = paused ? "tap to play" : "tap to pause";
      });
    }
  }
  function closeDemoModal() {
    if (_demoTimer) { clearInterval(_demoTimer); _demoTimer = null; }
    closeModal();
  }

  // Shared "See how" button for the athlete's exercise cards.
  function demoButton(ex, label = "See how") {
    const entry = demoForExercise(ex);
    if (!entry) return null;
    const btn = document.createElement("button");
    btn.className = "btn btn-sm btn-ghost demo-btn";
    btn.innerHTML = `<img class="demo-thumb" src="${demoImgUrl(entry.i, 0)}" alt="" loading="lazy" /><span>${escapeHtml(label)}</span>`;
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      openDemoModal(entry, ex.name);
    });
    return btn;
  }

  // Coach-side: confirm or override which demo an exercise is matched to.
  // Auto-matching is name-based and free text, so there's always an escape hatch.
  function openDemoPicker(ex, onDone) {
    const auto = findDemoByName(ex.name);
    const resultsHtml = (list) => list.length
      ? list.map((e) => `
          <button type="button" class="demo-pick" data-demo-id="${escapeHtml(e.i)}">
            <img src="${demoImgUrl(e.i, 0)}" alt="" loading="lazy" />
            <span class="demo-pick-name">${escapeHtml(e.n)}</span>
            <span class="demo-pick-meta">${escapeHtml(e.e || "")}</span>
          </button>`).join("")
      : `<p class="muted">No demo matches that search.</p>`;

    openModal({
      title: "Exercise demo",
      body: `
        <p class="muted demo-pick-intro">${auto
          ? `Auto-matched to <strong>${escapeHtml(auto.n)}</strong>. Pick a different one below if that's not the movement.`
          : `No automatic match for "${escapeHtml(ex.name || "this exercise")}". Search for the closest movement.`}</p>
        <input type="text" id="demo-pick-search" class="input" placeholder="Search demos…" value="${escapeHtml(ex.name || "")}" />
        <div class="demo-pick-list" id="demo-pick-list">${resultsHtml(demoSearch(ex.name || ""))}</div>`,
      actions: [
        { label: "Use auto match", className: "btn btn-ghost", onClick: () => {
          delete ex.demoId; saveTrainer(); closeModal(); onDone?.();
        } },
        { label: "No demo", className: "btn btn-ghost", onClick: () => {
          ex.demoId = "none"; saveTrainer(); closeModal(); onDone?.();
        } },
        { label: "Close", className: "btn btn-ghost", onClick: closeModal },
      ],
    });

    const search = $("#demo-pick-search");
    const list = $("#demo-pick-list");
    list.addEventListener("click", (e) => {
      const btn = e.target.closest(".demo-pick");
      if (!btn) return;
      ex.demoId = btn.dataset.demoId;
      saveTrainer();
      closeModal();
      onDone?.();
    });
    search.addEventListener("input", () => { list.innerHTML = resultsHtml(demoSearch(search.value)); });
    search.focus();
    search.select();
  }

  // The strip inside the coach's exercise detail panel: what the athlete will
  // see, one tap to preview it, one to change it.
  function buildCoachDemoRow(ex) {
    const row = document.createElement("div");
    row.className = "ex-demo-row";
    const paint = () => {
      row.innerHTML = "";
      const entry = demoForExercise(ex);
      const label = document.createElement("button");
      label.type = "button";
      label.className = "ex-demo-preview";
      if (entry) {
        label.innerHTML = `<img src="${demoImgUrl(entry.i, 0)}" alt="" loading="lazy" /><span>${escapeHtml(entry.n)}${ex.demoId && ex.demoId !== "none" ? "" : " <em>auto</em>"}</span>`;
        label.title = "Preview the demo the athlete sees";
        label.addEventListener("click", () => openDemoModal(entry, ex.name));
      } else {
        label.className += " is-empty";
        label.innerHTML = `<span>${ex.demoId === "none" ? "Demo hidden" : "No demo matched"}</span>`;
        label.addEventListener("click", () => openDemoPicker(ex, paint));
      }
      const change = document.createElement("button");
      change.type = "button";
      change.className = "btn btn-sm btn-ghost";
      change.textContent = entry ? "Change" : "Pick one";
      change.addEventListener("click", () => openDemoPicker(ex, paint));
      row.appendChild(label);
      row.appendChild(change);
    };
    paint();
    row._repaintDemo = paint; // the name input re-matches as the coach types
    return row;
  }

  function openVideoModal(ytId, name) {
    openModal({
      title: name ? `Demo: ${name}` : "Exercise demo",
      body: `
        <div class="video-frame-wrap">
          <iframe class="video-frame"
            src="https://www.youtube.com/embed/${encodeURIComponent(ytId)}?rel=0&autoplay=1"
            allow="accelerometer; autoplay; clipboard-write; encrypted-media; gyroscope; picture-in-picture"
            allowfullscreen
            referrerpolicy="strict-origin-when-cross-origin"></iframe>
        </div>
        <p class="muted" style="margin-top:0.7em">
          <a href="https://youtu.be/${encodeURIComponent(ytId)}" target="_blank" rel="noopener">Open on YouTube ↗</a>
        </p>`,
      actions: [{ label: "Close", className: "btn btn-ghost", onClick: () => {
        // Stop the video by clearing iframe before closing
        const f = document.querySelector(".video-frame");
        if (f) f.src = "about:blank";
        closeModal();
      }}],
    });
  }

  // -------- Athlete diet --------
  function renderClientDiet() {
    const container = $("#client-diet-container");
    container.innerHTML = "";
    const nut = state.clientData.program?.client?.nutrition;
    const cur = nut?.current;
    if (!cur || (!Number(cur.calories) && !Number(cur.protein))) {
      container.innerHTML = `<div class="empty-state"><div class="empty-emoji">🥩</div><h3>No nutrition plan yet</h3><p>Your coach hasn't set nutrition targets yet.</p></div>`;
      return;
    }
    const card = document.createElement("div");
    card.className = "card";
    const chart = macroDonutHtml(cur);
    // With fewer than two macros there's no split to chart — plain stat tiles.
    const tiles = chart ? "" : `
      <div class="client-diet-targets">
        <div class="client-diet-target">
          <div class="target-num">${escapeHtml(String(cur.calories || "—"))}</div>
          <div class="target-lbl">kcal / day</div>
        </div>
        <div class="client-diet-target">
          <div class="target-num">${escapeHtml(cur.protein ? cur.protein + "g" : "—")}</div>
          <div class="target-lbl">protein / day</div>
        </div>
      </div>`;
    card.innerHTML = `
      <div class="nutrition-plan-head">
        <h3 style="margin:0">Daily targets</h3>
        ${cur.effectiveFrom ? `<span class="muted" style="font-size:0.8rem">since ${escapeHtml(cur.effectiveFrom)}</span>` : ""}
      </div>
      ${chart}${tiles}
      ${cur.notes ? `<div class="client-instructions" style="margin-top:0.8em">${escapeHtml(cur.notes)}</div>` : ""}`;
    container.appendChild(card);

    const history = nut.history || [];
    if (history.length) {
      const hist = document.createElement("div");
      hist.className = "card";
      hist.innerHTML = `<h4 style="margin-top:0">Past targets</h4>`;
      [...history].reverse().forEach((h) => {
        hist.insertAdjacentHTML("beforeend", `
          <div class="nutrition-history-row">
            <strong>${escapeHtml(nutritionPlanSummary(h))}</strong>
            <span class="muted">${escapeHtml(h.effectiveFrom || "")} → ${escapeHtml(h.endedAt || "")}</span>
          </div>`);
      });
      container.appendChild(hist);
    }
  }

  // -------- Athlete progress (bodyweight + feedback + send) --------
  function renderClientProgress() {
    $("#bw-date").value = todayISO();
    $("#bw-weight").value = "";
    $("#client-feedback").value = state.clientData.progress.feedback || "";
    renderBwHistory();
  }
  // Newest-first: sort by date, then time-of-day when present.
  function bwSort(a, b) {
    return (b.date + (b.time || "")).localeCompare(a.date + (a.time || ""));
  }
  // Shared body-weight row used by both the athlete history and the coach's
  // read-only view. Shows an expandable metrics grid when the entry carries
  // extra scale readings (body fat, muscle mass, etc.) from a CSV import.
  function bwEntryEl(b, { deletable = false, onDelete } = {}) {
    const el = document.createElement("div");
    el.className = "bw-entry-wrap";
    const metrics = Array.isArray(b.metrics) ? b.metrics : [];
    const when = b.time ? `${b.date} · ${String(b.time).slice(0, 5)}` : b.date;
    const toggleLabel = (open) => `${open ? "▾" : "▸"} ${metrics.length} metric${metrics.length === 1 ? "" : "s"}`;
    el.innerHTML = `
      <div class="bw-entry">
        <span><span class="date">${escapeHtml(when)}</span> · <strong>${escapeHtml(b.weightLb)} lb</strong>${metrics.length ? ` <button class="bw-toggle" type="button">${toggleLabel(false)}</button>` : ""}</span>
        ${deletable ? `<button class="delete-bw" title="Delete">×</button>` : ""}
      </div>
      ${metrics.length ? `<div class="bw-metrics hidden">${metrics.map((m) => `<div class="bw-metric"><span>${escapeHtml(m.label)}</span><strong>${escapeHtml(String(m.value))}${m.unit ? " " + escapeHtml(m.unit) : ""}</strong></div>`).join("")}</div>` : ""}`;
    const tog = el.querySelector(".bw-toggle");
    if (tog) {
      tog.addEventListener("click", () => {
        const grid = el.querySelector(".bw-metrics");
        const open = !grid.classList.toggle("hidden");
        tog.textContent = toggleLabel(open);
      });
    }
    if (deletable) el.querySelector(".delete-bw").addEventListener("click", () => onDelete && onDelete(b));
    return el;
  }
  function renderBwHistory() {
    const log = state.clientData.progress.bodyweightLog || [];
    renderBwCharts($("#bw-charts"), log);
    const wrap = $("#bw-history");
    wrap.innerHTML = "";
    if (!log.length) { wrap.innerHTML = `<p class="muted">No weight entries yet.</p>`; return; }
    [...log].sort(bwSort).forEach((b) => {
      wrap.appendChild(bwEntryEl(b, {
        deletable: true,
        onDelete: (entry) => {
          if (!window.confirm("Delete this entry?")) return;
          state.clientData.progress.bodyweightLog =
            state.clientData.progress.bodyweightLog.filter((x) => x.id !== entry.id);
          saveClient();
          renderBwHistory();
        },
      }));
    });
  }
  function logBodyweight() {
    const date = $("#bw-date").value || todayISO();
    const w = $("#bw-weight").value;
    if (!w) { toast("Enter a weight"); return; }
    state.clientData.progress.bodyweightLog.push({ id: uid(), date, weightLb: w });
    saveClient();
    $("#bw-weight").value = "";
    renderBwHistory();
    toast("Weight logged ✓");
  }

  // -------- Smart-scale (Renpho) CSV import --------
  const KG_TO_LB = 2.20462;
  // Split one CSV line, honoring simple double-quoted fields.
  function csvSplitLine(line) {
    const out = [];
    let cur = "", q = false;
    for (let i = 0; i < line.length; i++) {
      const ch = line[i];
      if (q) {
        if (ch === '"') { if (line[i + 1] === '"') { cur += '"'; i++; } else q = false; }
        else cur += ch;
      } else if (ch === '"') { q = true; }
      else if (ch === ",") { out.push(cur); cur = ""; }
      else cur += ch;
    }
    out.push(cur);
    return out.map((s) => s.trim());
  }
  // Parse a Renpho "Health" CSV export into weigh-in entries. Tolerant of
  // column order, missing readings ("--"), and lb-vs-kg (unit lives in the
  // header, e.g. "Weight(lb)"); kg columns are converted to lb.
  function parseScaleCsv(text) {
    const lines = text.split(/\r?\n/).filter((l) => l.trim().length);
    if (lines.length < 2) return { entries: [], error: "That file has no data rows." };
    const headers = csvSplitLine(lines[0]);
    // A trailing "(...)" is only a unit if it looks like one — otherwise it's a
    // description (e.g. "WHR (Waist-to-Hip Ratio)") and stays part of the label.
    const UNIT_RE = /^(%|lb|lbs|kg|g|kcal|cal|cm|in|yr|yrs|bpm|kg\/m²|kg\/m2)$/i;
    const headerParts = (h) => {
      const m = h.match(/^(.*?)\s*\(([^)]*)\)\s*$/);
      if (m && UNIT_RE.test(m[2].trim())) return { label: m[1].trim(), unit: m[2].trim() };
      return { label: h.trim(), unit: "" };
    };
    let dateIdx = -1, timeIdx = -1, weightIdx = -1;
    headers.forEach((h, i) => {
      const n = h.toLowerCase();
      if (dateIdx < 0 && /date/.test(n)) dateIdx = i;
      if (timeIdx < 0 && /time/.test(n)) timeIdx = i;
      if (weightIdx < 0 && /^weight/.test(n)) weightIdx = i;
    });
    if (dateIdx < 0 || weightIdx < 0) {
      return { entries: [], error: "Couldn't find Date and Weight columns. Is this a Renpho export?" };
    }
    const weightIsKg = /kg/i.test(headerParts(headers[weightIdx]).unit);
    const entries = [];
    for (let r = 1; r < lines.length; r++) {
      const cells = csvSplitLine(lines[r]);
      const date = (cells[dateIdx] || "").replace(/[./]/g, "-"); // 2026.06.26 → 2026-06-26
      if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) continue;
      const time = timeIdx >= 0 ? (cells[timeIdx] || "") : "";
      const rawW = cells[weightIdx];
      if (!rawW || rawW === "--") continue;
      let wv = parseFloat(rawW);
      if (!isFinite(wv)) continue;
      if (weightIsKg) wv *= KG_TO_LB;
      const weightLb = String(Math.round(wv * 10) / 10);
      const metrics = [];
      headers.forEach((h, i) => {
        if (i === dateIdx || i === timeIdx || i === weightIdx) return;
        const n = h.toLowerCase();
        if (n === "" || /^no\.?$/.test(n)) return; // skip index + trailing empty column
        const raw = cells[i];
        if (raw == null || raw === "" || raw === "--") return;
        const parts = headerParts(h);
        let unit = parts.unit, value = raw;
        if (/^[-+]?\d*\.?\d+$/.test(raw)) {
          const num = parseFloat(raw);
          if (/kg/i.test(unit)) { value = Math.round(num * KG_TO_LB * 10) / 10; unit = "lb"; }
          else value = num;
        }
        metrics.push({ label: parts.label, value, unit });
      });
      entries.push({ date, time, weightLb, metrics });
    }
    return { entries, error: null };
  }
  function importScaleCsv(file) {
    const reader = new FileReader();
    reader.onload = () => {
      const { entries, error } = parseScaleCsv(String(reader.result || ""));
      if (error) { toast(error); return; }
      if (!entries.length) { toast("No weigh-ins found in that file."); return; }
      const log = state.clientData.progress.bodyweightLog;
      // Dedupe by date + time so multiple weigh-ins on one day are all kept,
      // but re-importing the same file adds nothing.
      const seen = new Set(log.map((e) => e.date + "|" + (e.time || "")));
      let added = 0;
      entries.forEach((e) => {
        const key = e.date + "|" + (e.time || "");
        if (seen.has(key)) return;
        seen.add(key);
        log.push({ id: uid(), date: e.date, time: e.time, weightLb: e.weightLb, metrics: e.metrics, source: "renpho" });
        added++;
      });
      saveClient();
      renderBwHistory();
      toast(added ? `Imported ${added} weigh-in${added === 1 ? "" : "s"} ✓` : "Already up to date. Nothing new.");
    };
    reader.onerror = () => toast("Couldn't read that file.");
    reader.readAsText(file);
  }

  // -------- Body-composition trend charts (hand-rolled SVG small multiples) --------
  const round1 = (n) => Math.round(n * 10) / 10;
  let bwChartRange = "all"; // "30" | "90" | "all" — shared across athlete + coach views
  const BW_RANGES = [
    { k: "30", label: "30d", days: 30 },
    { k: "90", label: "90d", days: 90 },
    { k: "all", label: "All", days: null },
  ];
  const BW_CHART_SPECS = [
    { key: "weight", title: "Weight", unit: "lb", val: (e) => { const v = parseFloat(e.weightLb); return isFinite(v) ? v : null; } },
    { key: "bodyfat", title: "Body Fat", unit: "%", val: (e) => bwMetricVal(e, /^body fat perc/i) },
    { key: "muscle", title: "Muscle Mass", unit: "lb", val: (e) => { const v = bwMetricVal(e, /^muscle mass/i); return v != null ? v : bwMetricVal(e, /^skeletal muscle mass/i); } },
  ];
  function bwMetricVal(e, re) {
    if (!Array.isArray(e.metrics)) return null;
    const m = e.metrics.find((x) => re.test(x.label));
    if (!m) return null;
    const v = typeof m.value === "number" ? m.value : parseFloat(m.value);
    return isFinite(v) ? v : null;
  }
  function bwEntryTime(e) {
    const t = e.time && /^\d{2}:\d{2}/.test(e.time) ? e.time : "12:00:00";
    const ms = new Date(`${e.date}T${t}`).getTime();
    return isFinite(ms) ? ms : new Date(`${e.date}T12:00:00`).getTime();
  }
  // Render the small-multiple trend cards into `container` from a bodyweight log.
  // Shared by the athlete's own view and the coach's read-only athlete view.
  function renderBwCharts(container, log) {
    if (!container) return;
    container.innerHTML = "";
    const all = [...(log || [])];
    if (all.length < 2) return; // nothing to trend yet
    const latestT = Math.max(...all.map(bwEntryTime));
    const range = BW_RANGES.find((r) => r.k === bwChartRange) || BW_RANGES[2];
    const cutoff = range.days == null ? -Infinity : latestT - range.days * 86400000;

    const grid = document.createElement("div");
    grid.className = "bw-charts-grid";
    BW_CHART_SPECS.forEach((spec) => {
      const pts = all
        .map((e) => ({ t: bwEntryTime(e), v: spec.val(e), date: e.date, time: e.time }))
        .filter((p) => p.v != null && p.t >= cutoff)
        .sort((a, b) => a.t - b.t);
      if (pts.length < 2) return; // need at least two readings to draw a trend
      grid.appendChild(bwChartCard(spec, pts));
    });
    if (!grid.children.length) return; // e.g. range too tight — show nothing

    const head = document.createElement("div");
    head.className = "bw-charts-head";
    head.innerHTML = `<h4>Body composition trends</h4>
      <div class="bw-range" role="group" aria-label="Time range">${BW_RANGES.map((r) => `<button type="button" class="bw-range-btn${r.k === bwChartRange ? " on" : ""}" data-r="${r.k}">${r.label}</button>`).join("")}</div>`;
    head.querySelectorAll(".bw-range-btn").forEach((b) => b.addEventListener("click", () => {
      bwChartRange = b.dataset.r;
      renderBwCharts(container, log);
    }));
    container.appendChild(head);
    container.appendChild(grid);
  }
  function bwChartCard(spec, pts) {
    const W = 320, H = 96, padL = 4, padR = 4, padT = 12, padB = 10;
    const last = pts[pts.length - 1].v;
    const delta = last - pts[0].v;
    const tMin = pts[0].t, tMax = pts[pts.length - 1].t;
    const vals = pts.map((p) => p.v);
    let vMin = Math.min(...vals), vMax = Math.max(...vals);
    if (vMin === vMax) { vMin -= 1; vMax += 1; }
    const vpad = (vMax - vMin) * 0.12; vMin -= vpad; vMax += vpad;
    const xOf = (t) => tMax === tMin ? W / 2 : padL + ((t - tMin) / (tMax - tMin)) * (W - padL - padR);
    const yOf = (v) => padT + (1 - (v - vMin) / (vMax - vMin)) * (H - padT - padB);
    const xy = pts.map((p) => ({ x: xOf(p.t), y: yOf(p.v), v: p.v, date: p.date, time: p.time }));
    const line = xy.map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");
    const area = `${line} L${xy[xy.length - 1].x.toFixed(1)} ${H - padB} L${xy[0].x.toFixed(1)} ${H - padB} Z`;
    const lastPt = xy[xy.length - 1];
    const gid = "bwg-" + spec.key + "-" + Math.random().toString(36).slice(2, 7);
    const arrow = Math.abs(delta) < 0.05 ? "▬" : (delta > 0 ? "▲" : "▼");

    const card = document.createElement("div");
    card.className = "bw-chart-card";
    card.innerHTML = `
      <div class="bw-chart-top">
        <span class="bw-chart-title">${escapeHtml(spec.title)}</span>
        <span class="bw-chart-delta" title="Change over range">${arrow} ${Math.abs(delta).toFixed(1)}</span>
      </div>
      <div class="bw-chart-val">${escapeHtml(String(round1(last)))}<span class="bw-chart-unit">${escapeHtml(spec.unit)}</span></div>
      <div class="bw-chart-plot">
        <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" class="bw-chart-svg" aria-hidden="true">
          <defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="currentColor" stop-opacity="0.22"/>
            <stop offset="1" stop-color="currentColor" stop-opacity="0"/>
          </linearGradient></defs>
          <path d="${area}" fill="url(#${gid})" stroke="none"/>
          <path d="${line}" fill="none" stroke="currentColor" stroke-width="2" vector-effect="non-scaling-stroke" stroke-linejoin="round" stroke-linecap="round"/>
        </svg>
        <div class="bw-cross" style="display:none"></div>
        <div class="bw-dot bw-hover-dot" style="display:none"></div>
        <div class="bw-dot bw-last-dot" style="left:${(lastPt.x / W * 100).toFixed(2)}%; top:${(lastPt.y / H * 100).toFixed(2)}%"></div>
        <div class="bw-chart-tip" style="display:none"></div>
      </div>`;

    const plot = card.querySelector(".bw-chart-plot");
    const cross = card.querySelector(".bw-cross");
    const hdot = card.querySelector(".bw-hover-dot");
    const tip = card.querySelector(".bw-chart-tip");
    const data = xy.map((p) => ({ fx: p.x / W, fy: p.y / H, v: p.v, date: p.date, time: p.time }));
    const showAt = (clientX) => {
      const rect = plot.getBoundingClientRect();
      if (!rect.width) return;
      let f = (clientX - rect.left) / rect.width; f = Math.max(0, Math.min(1, f));
      let best = data[0], bd = Infinity;
      data.forEach((d) => { const dd = Math.abs(d.fx - f); if (dd < bd) { bd = dd; best = d; } });
      const lx = (best.fx * 100).toFixed(2) + "%";
      cross.style.display = ""; cross.style.left = lx;
      hdot.style.display = ""; hdot.style.left = lx; hdot.style.top = (best.fy * 100).toFixed(2) + "%";
      const when = best.time ? `${best.date} · ${String(best.time).slice(0, 5)}` : best.date;
      tip.style.display = "";
      tip.innerHTML = `<strong>${escapeHtml(String(round1(best.v)))} ${escapeHtml(spec.unit)}</strong><span>${escapeHtml(when)}</span>`;
      tip.style.left = Math.max(4, Math.min(rect.width - 4, best.fx * rect.width)) + "px";
    };
    const hide = () => { cross.style.display = "none"; hdot.style.display = "none"; tip.style.display = "none"; };
    plot.addEventListener("pointermove", (e) => showAt(e.clientX));
    plot.addEventListener("pointerdown", (e) => showAt(e.clientX));
    plot.addEventListener("pointerleave", hide);
    return card;
  }

  // ============ Gamification & insights ============

  // -------- Strength progression (per-exercise trend) --------
  // History is aggregated by exercise NAME across every week/day (each week's
  // copy of "Bench Press" has its own id), using the top working-set weight
  // of each logged session. Needs ≥2 sessions of a lift to draw anything.
  const _strengthSelByHost = {};
  function exerciseHistoryByName(client, progress) {
    const logs = progress?.exerciseLogs || {};
    const byName = {};
    // One-off coach sessions ride along as a pseudo-week: their top sets are
    // real strength data and belong on the trend line.
    [...(client?.weeks || []), { days: client?.oneOffDays || [] }].forEach((w) => (w.days || []).forEach((d) => (d.exercises || []).forEach((ex) => {
      const name = (ex.name || "").trim();
      // Timed carries are excluded — seconds would read as reps in e1RM math.
      if (!name || ex.kind === "mobility" || exIsTimed(ex)) return;
      (logs[ex.id] || []).forEach((l) => {
        let top = null;
        (l.sets || []).forEach((s) => {
          const wgt = parseFloat(s.weight); const reps = parseInt(s.reps) || 0;
          if (!isFinite(wgt) || wgt <= 0) return;
          if (!top || wgt > top.v || (wgt === top.v && reps > top.reps)) top = { v: wgt, reps };
        });
        if (!top || !l.date) return;
        (byName[name] = byName[name] || []).push({ t: new Date(l.date + "T12:00:00").getTime(), v: top.v, reps: top.reps, date: l.date });
      });
    })));
    Object.keys(byName).forEach((n) => {
      const seen = {};
      byName[n] = byName[n].sort((a, b) => a.t - b.t).filter((p) => (seen[p.date] ? false : (seen[p.date] = 1)));
      if (byName[n].length < 2) delete byName[n];
    });
    return byName;
  }
  function renderStrengthProgress(host, client, progress) {
    if (!host) return;
    host.innerHTML = "";
    const byName = exerciseHistoryByName(client, progress);
    const names = Object.keys(byName).sort((a, b) => byName[b].length - byName[a].length);
    if (!names.length) return;
    const key = host.id || "s";
    let sel = _strengthSelByHost[key];
    if (!names.includes(sel)) sel = names[0];
    _strengthSelByHost[key] = sel;
    const card = document.createElement("div");
    card.className = "card strength-progress-card";
    card.innerHTML = `
      <div class="bw-charts-head">
        <h4>📈 Strength progress</h4>
        <select class="strength-ex-select" aria-label="Exercise">${names.map((n) => `<option${n === sel ? " selected" : ""}>${escapeHtml(n)}</option>`).join("")}</select>
      </div>`;
    card.appendChild(strengthChartCard(sel, byName[sel]));
    card.querySelector(".strength-ex-select").addEventListener("change", (e) => {
      _strengthSelByHost[key] = e.target.value;
      renderStrengthProgress(host, client, progress);
    });
    host.appendChild(card);
  }
  // -------- PR archive (each recorded PR plotted over time) --------
  // Groups the athlete's logged PRs by lift and plots the milestone value over
  // time — weight for weighted lifts, reps for bodyweight — so they can see
  // when their last PR landed. Needs ≥2 dated PRs for a given lift to draw.
  function prArchiveByName(prs) {
    const byName = {};
    (prs || []).forEach((p) => {
      if (!p.name || !p.date) return;
      const repOnly = prIsRepOnly(p);
      const v = repOnly ? (parseInt(p.reps, 10) || 0) : Number(p.weight);
      if (!v || !isFinite(v)) return;
      const k = exKey(p.name);
      (byName[k] = byName[k] || { name: p.name.trim(), bw: repOnly, pts: [] })
        .pts.push({ t: new Date(p.date + "T12:00:00").getTime(), v, reps: parseInt(p.reps, 10) || 0, date: p.date });
    });
    Object.keys(byName).forEach((k) => {
      const seen = {};
      byName[k].pts = byName[k].pts.sort((a, b) => a.t - b.t)
        .filter((p) => (seen[p.date] ? false : (seen[p.date] = 1)));
      if (byName[k].pts.length < 2) delete byName[k];
    });
    return byName;
  }
  function renderPRArchive(host, prs) {
    if (!host) return;
    host.innerHTML = "";
    const byName = prArchiveByName(prs);
    const keys = Object.keys(byName).sort((a, b) => byName[b].pts.length - byName[a].pts.length);
    if (!keys.length) return;
    const hid = host.id || "pra";
    let sel = _strengthSelByHost[hid];
    if (!byName[sel]) sel = keys[0];
    _strengthSelByHost[hid] = sel;
    const g = byName[sel];
    const card = document.createElement("div");
    card.className = "card strength-progress-card";
    card.innerHTML = `
      <div class="bw-charts-head">
        <h4>🏆 PR archive</h4>
        <select class="strength-ex-select" aria-label="Exercise">${keys.map((k) => `<option value="${escapeHtml(k)}"${k === sel ? " selected" : ""}>${escapeHtml(byName[k].name)}</option>`).join("")}</select>
      </div>`;
    card.appendChild(strengthChartCard(g.name, g.pts, { unit: g.bw ? "reps" : "lb", title: `${g.pts.length} PRs over time`, bw: g.bw }));
    card.querySelector(".strength-ex-select").addEventListener("change", (e) => {
      _strengthSelByHost[hid] = e.target.value;
      renderPRArchive(host, prs);
    });
    host.appendChild(card);
  }

  // Same anatomy/interaction as the bodyweight trend cards (shared CSS).
  // opts.unit / opts.title / opts.bw let the PR archive reuse this component
  // (reps instead of lb, a milestone-count subtitle).
  function strengthChartCard(name, pts, opts = {}) {
    const unit = opts.unit != null ? opts.unit : "lb";
    const title = opts.title != null ? opts.title : `Top set · ${pts.length} sessions`;
    const W = 320, H = 96, padL = 4, padR = 4, padT = 12, padB = 10;
    const last = pts[pts.length - 1].v;
    const delta = last - pts[0].v;
    const tMin = pts[0].t, tMax = pts[pts.length - 1].t;
    let vMin = Math.min(...pts.map((p) => p.v)), vMax = Math.max(...pts.map((p) => p.v));
    if (vMin === vMax) { vMin -= 1; vMax += 1; }
    const vpad = (vMax - vMin) * 0.12; vMin -= vpad; vMax += vpad;
    const xOf = (t) => tMax === tMin ? W / 2 : padL + ((t - tMin) / (tMax - tMin)) * (W - padL - padR);
    const yOf = (v) => padT + (1 - (v - vMin) / (vMax - vMin)) * (H - padT - padB);
    const xy = pts.map((p) => ({ x: xOf(p.t), y: yOf(p.v), v: p.v, reps: p.reps, date: p.date }));
    const line = xy.map((p, i) => `${i ? "L" : "M"}${p.x.toFixed(1)} ${p.y.toFixed(1)}`).join(" ");
    const area = `${line} L${xy[xy.length - 1].x.toFixed(1)} ${H - padB} L${xy[0].x.toFixed(1)} ${H - padB} Z`;
    const lastPt = xy[xy.length - 1];
    const gid = "sxg-" + Math.random().toString(36).slice(2, 7);
    const arrow = Math.abs(delta) < 0.05 ? "▬" : (delta > 0 ? "▲" : "▼");
    const card = document.createElement("div");
    card.className = "bw-chart-card";
    card.innerHTML = `
      <div class="bw-chart-top">
        <span class="bw-chart-title">${escapeHtml(title)}</span>
        <span class="bw-chart-delta" title="Change over the logged history">${arrow} ${Math.abs(delta).toFixed(0)} ${escapeHtml(unit)}</span>
      </div>
      <div class="bw-chart-val">${escapeHtml(String(last))}<span class="bw-chart-unit">${escapeHtml(unit)}</span></div>
      <div class="bw-chart-plot">
        <svg viewBox="0 0 ${W} ${H}" preserveAspectRatio="none" class="bw-chart-svg" aria-hidden="true">
          <defs><linearGradient id="${gid}" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0" stop-color="currentColor" stop-opacity="0.22"/>
            <stop offset="1" stop-color="currentColor" stop-opacity="0"/>
          </linearGradient></defs>
          <path d="${area}" fill="url(#${gid})" stroke="none"/>
          <path d="${line}" fill="none" stroke="currentColor" stroke-width="2" vector-effect="non-scaling-stroke" stroke-linejoin="round" stroke-linecap="round"/>
        </svg>
        <div class="bw-cross" style="display:none"></div>
        <div class="bw-dot bw-hover-dot" style="display:none"></div>
        <div class="bw-dot bw-last-dot" style="left:${(lastPt.x / W * 100).toFixed(2)}%; top:${(lastPt.y / H * 100).toFixed(2)}%"></div>
        <div class="bw-chart-tip" style="display:none"></div>
      </div>`;
    const plot = card.querySelector(".bw-chart-plot");
    const cross = card.querySelector(".bw-cross");
    const hdot = card.querySelector(".bw-hover-dot");
    const tip = card.querySelector(".bw-chart-tip");
    const data = xy.map((p) => ({ fx: p.x / W, fy: p.y / H, v: p.v, reps: p.reps, date: p.date }));
    const showAt = (clientX) => {
      const rect = plot.getBoundingClientRect();
      if (!rect.width) return;
      let f = (clientX - rect.left) / rect.width; f = Math.max(0, Math.min(1, f));
      let best = data[0], bd = Infinity;
      data.forEach((d) => { const dd = Math.abs(d.fx - f); if (dd < bd) { bd = dd; best = d; } });
      const lx = (best.fx * 100).toFixed(2) + "%";
      cross.style.display = ""; cross.style.left = lx;
      hdot.style.display = ""; hdot.style.left = lx; hdot.style.top = (best.fy * 100).toFixed(2) + "%";
      tip.style.display = "";
      tip.innerHTML = opts.bw
        ? `<strong>${escapeHtml(String(best.v))} reps</strong><span>${escapeHtml(best.date)}</span>`
        : `<strong>${escapeHtml(String(best.v))} lb × ${escapeHtml(String(best.reps || "?"))}</strong><span>${escapeHtml(best.date)}</span>`;
      tip.style.left = Math.max(4, Math.min(rect.width - 4, best.fx * rect.width)) + "px";
    };
    const hideTip = () => { cross.style.display = "none"; hdot.style.display = "none"; tip.style.display = "none"; };
    plot.addEventListener("pointermove", (e) => showAt(e.clientX));
    plot.addEventListener("pointerdown", (e) => showAt(e.clientX));
    plot.addEventListener("pointerleave", hideTip);
    return card;
  }

  // -------- Weekly streak / tonnage / badges / recap --------
  function completionDateList(progress) {
    const out = [];
    Object.values(progress?.dayCompletions || {}).forEach((v) => (Array.isArray(v) ? v : []).forEach((d) => { if (d) out.push(d); }));
    return [...new Set(out)].sort();
  }
  function weekStartISO(iso) { const d = new Date(iso + "T12:00:00"); d.setDate(d.getDate() - ((d.getDay() + 6) % 7)); return dateISO(d); }
  function addDaysISO(iso, n) { const d = new Date(iso + "T12:00:00"); d.setDate(d.getDate() + n); return dateISO(d); }
  // Consecutive calendar weeks (Mon-start) with ≥1 completed workout. The
  // current week only counts once it has a completion, and a quiet current
  // week doesn't break the run — training streaks respect rest days.
  function weeklyStreak(progress) {
    const wk = new Set(completionDateList(progress).map(weekStartISO));
    if (!wk.size) return 0;
    let cursor = weekStartISO(todayISO());
    if (!wk.has(cursor)) cursor = addDaysISO(cursor, -7);
    let n = 0;
    while (wk.has(cursor)) { n++; cursor = addDaysISO(cursor, -7); }
    return n;
  }
  function lifetimeTonnage(progress) {
    let t = 0;
    Object.values(progress?.exerciseLogs || {}).forEach((ls) => (ls || []).forEach((l) => {
      (l.sets || []).forEach((s) => {
        const w = parseFloat(s.weight), r = parseInt(s.reps) || 0;
        if (isFinite(w) && w > 0 && r) t += w * r;
      });
    }));
    return Math.round(t);
  }
  function formatTonnage(t) {
    if (t >= 1e6) return (t / 1e6).toFixed(2) + "M";
    if (t >= 1e4) return Math.round(t / 1000) + "k";
    return t.toLocaleString();
  }
  // Volume (weight × reps, working sets) bucketed by week or calendar month,
  // as a contiguous run ending at the current period — quiet periods show as
  // zero rather than vanishing. Capped to the last 12 buckets.
  const KEY_VOLMODE = "trainerpro_volmode_v1"; // "week" (default) | "month"
  function volumeBuckets(progress, mode) {
    const by = {};
    Object.values(progress?.exerciseLogs || {}).forEach((ls) => (ls || []).forEach((l) => {
      if (!l.date) return;
      const k = mode === "week" ? weekStartISO(l.date) : l.date.slice(0, 7);
      (l.sets || []).forEach((s) => {
        const w = parseFloat(s.weight), r = parseInt(s.reps) || 0;
        if (isFinite(w) && w > 0 && r) by[k] = (by[k] || 0) + w * r;
      });
    }));
    const keys = Object.keys(by).sort();
    if (!keys.length) return [];
    const out = [];
    let cur = keys[0];
    const end = mode === "week" ? weekStartISO(todayISO()) : todayISO().slice(0, 7);
    while (cur <= end && out.length < 120) {
      out.push({ key: cur, v: Math.round(by[cur] || 0) });
      if (mode === "week") {
        cur = addDaysISO(cur, 7);
      } else {
        const [y, m] = cur.split("-").map(Number);
        cur = m === 12 ? `${y + 1}-01` : `${y}-${String(m + 1).padStart(2, "0")}`;
      }
    }
    const last12 = out.slice(-12);
    last12.forEach((o) => {
      o.label = mode === "week"
        ? new Date(o.key + "T12:00:00").toLocaleDateString(undefined, { month: "numeric", day: "numeric" })
        : new Date(o.key + "-15T12:00:00").toLocaleDateString(undefined, { month: "short" });
    });
    return last12;
  }
  function renderVolumeChart(progress) {
    const host = $("#ov-volchart-host");
    if (!host) return;
    const mode = localStorage.getItem(KEY_VOLMODE) === "month" ? "month" : "week";
    const buckets = volumeBuckets(progress, mode);
    if (buckets.length < 2) { host.innerHTML = ""; return; }
    const maxV = Math.max(...buckets.map((m) => m.v), 1);
    host.innerHTML = `<div class="ov-volchart">
      <div class="ov-recap-head"><h4>${mode === "week" ? "Weekly" : "Monthly"} volume</h4>
        <div class="bw-range" role="group" aria-label="Bucket size">
          <button type="button" class="bw-range-btn${mode === "week" ? " on" : ""}" data-volmode="week">Weeks</button>
          <button type="button" class="bw-range-btn${mode === "month" ? " on" : ""}" data-volmode="month">Months</button>
        </div>
      </div>
      <div class="vol-chart">${buckets.map((m) => `
        <div class="vol-col" title="${mode === "week" ? "Week of " : ""}${escapeHtml(m.label)}: ${m.v.toLocaleString()} lb lifted">
          <span class="vol-val">${m.v ? formatTonnage(m.v) : ""}</span>
          <div class="vol-bar" style="height:${Math.max(2, Math.round((m.v / maxV) * 100))}%"></div>
          <span class="vol-lbl">${escapeHtml(m.label)}</span>
        </div>`).join("")}</div>
    </div>`;
    host.querySelectorAll("[data-volmode]").forEach((b) => b.addEventListener("click", () => {
      localStorage.setItem(KEY_VOLMODE, b.dataset.volmode);
      renderVolumeChart(progress);
    }));
  }

  // Total volume (weight × reps, working sets) of the most recent logged day.
  function lastWorkoutVolume(progress) {
    const byDate = {};
    Object.values(progress?.exerciseLogs || {}).forEach((ls) => (ls || []).forEach((l) => {
      if (!l.date) return;
      (l.sets || []).forEach((s) => {
        const w = parseFloat(s.weight), r = parseInt(s.reps) || 0;
        if (isFinite(w) && w > 0 && r) byDate[l.date] = (byDate[l.date] || 0) + w * r;
      });
    }));
    const dates = Object.keys(byDate).sort();
    if (!dates.length) return null;
    const date = dates[dates.length - 1];
    return { date, volume: Math.round(byDate[date]) };
  }
  // Heaviest set ever put up on the big lifts (squat / bench / any deadlift,
  // trap bar included / pulldown variations) — from workout logs plus the
  // athlete's PR list.
  function bestBigThreeLift(progress, client) {
    const rx = /(deadlift|squat|bench|pull.?down)/i;
    let best = 0;
    const logs = progress?.exerciseLogs || {};
    (client?.weeks || []).forEach((w) => (w.days || []).forEach((d) => (d.exercises || []).forEach((ex) => {
      if (!rx.test(ex.name || "")) return;
      (logs[ex.id] || []).forEach((l) => (l.sets || []).forEach((s) => {
        const wgt = parseFloat(s.weight);
        if (isFinite(wgt) && wgt > best) best = wgt;
      }));
    })));
    (progress?.personalRecords || []).forEach((p) => {
      if (!rx.test(p.name || "")) return;
      const wgt = parseFloat(p.weight);
      if (isFinite(wgt) && wgt > best) best = wgt;
    });
    return best;
  }
  function latestBodyweight(progress, client) {
    const latest = [...(progress?.bodyweightLog || [])]
      .sort((a, b) => (b.date || "").localeCompare(a.date || ""))[0];
    const v = parseFloat(latest?.weightLb ?? client?.weightLb);
    return isFinite(v) && v > 0 ? v : null;
  }
  // Most pull-ups / chin-ups in a single set — logs plus the PR list.
  function bestPullupReps(progress, client) {
    const rx = /(pull.?up|chin.?up)/i;
    let best = 0;
    const logs = progress?.exerciseLogs || {};
    (client?.weeks || []).forEach((w) => (w.days || []).forEach((d) => (d.exercises || []).forEach((ex) => {
      if (!rx.test(ex.name || "")) return;
      (logs[ex.id] || []).forEach((l) => (l.sets || []).forEach((s) => {
        const r = parseInt(s.reps) || 0;
        if (r > best) best = r;
      }));
    })));
    (progress?.personalRecords || []).forEach((p) => {
      if (!rx.test(p.name || "")) return;
      const r = parseInt(p.reps) || 0;
      if (r > best) best = r;
    });
    return best;
  }
  // -------- Cardio + rep-count totals (feed the racing stats bar) --------
  // Cardio logs are standalone entries: { type, minutes, intensity, date, miles? }.
  // `miles` is optional and only present on entries logged since distance was added.
  function cardioLogList(progress) {
    return (progress?.cardioLogs || []).filter((l) => l && l.date);
  }
  function cardioMinutes(progress, sinceISO) {
    return cardioLogList(progress).reduce((t, l) => {
      if (sinceISO && l.date < sinceISO) return t;
      return t + (parseInt(l.minutes) || 0);
    }, 0);
  }
  function cardioMiles(progress) {
    return cardioLogList(progress).reduce((t, l) => {
      const m = parseFloat(l.miles);
      return isFinite(m) && m > 0 ? t + m : t;
    }, 0);
  }
  // Minutes as "3h 20m" once past an hour — a four-digit minute count reads as noise.
  function formatMinutes(min) {
    if (min < 60) return `${min}`;
    const h = Math.floor(min / 60), m = min % 60;
    return m ? `${h}h ${m}m` : `${h}h`;
  }
  // Lifetime active-workout time (ms) → "45m" / "42h 10m".
  function formatWorkoutTime(ms) {
    const totalMin = Math.round((ms || 0) / 60000);
    if (totalMin < 60) return `${totalMin}m`;
    const h = Math.floor(totalMin / 60), m = totalMin % 60;
    return m ? `${h}h ${m}m` : `${h}h`;
  }
  // Heaviest single PR across coach-set PRs (pr1) and the athlete's logged PRs.
  function highestPR(client, progress) {
    let best = null; // { name, weight }
    const consider = (name, w) => {
      const n = parseFloat(w);
      if (!isFinite(n) || n <= 0) return;
      if (!best || n > best.weight) best = { name: name || "", weight: n };
    };
    (client?.coachPRs || []).forEach((p) => consider(p.name, p.pr1));
    (progress?.personalRecords || []).forEach((p) => consider(p.name, p.weight));
    return best;
  }
  // Every rep ever logged for exercises whose name matches `rx`. Walks the
  // program to map exercise ids → names, the same way bestPullupReps does.
  // Passing no regex counts every logged rep.
  function totalRepsMatching(progress, client, rx) {
    const logs = progress?.exerciseLogs || {};
    let total = 0;
    const counted = new Set();
    (client?.weeks || []).forEach((w) => (w.days || []).forEach((d) => (d.exercises || []).forEach((ex) => {
      if (rx && !rx.test(ex.name || "")) return;
      if (counted.has(ex.id)) return; // same exercise can appear in several weeks
      counted.add(ex.id);
      (logs[ex.id] || []).forEach((l) => (l.sets || []).forEach((s) => {
        total += parseInt(s.reps) || 0;
      }));
    })));
    return total;
  }
  function totalRepsAll(progress) {
    let total = 0;
    Object.values(progress?.exerciseLogs || {}).forEach((ls) => (ls || []).forEach((l) => {
      (l.sets || []).forEach((s) => { total += parseInt(s.reps) || 0; });
    }));
    return total;
  }

  function computeBadges(progress, client) {
    const dates = completionDateList(progress);
    const workouts = dates.length;
    const prCount = (progress?.personalRecords || []).length;
    const ton = lifetimeTonnage(progress);
    const streak = weeklyStreak(progress);
    let comeback = false;
    for (let i = 1; i < dates.length; i++) {
      if ((new Date(dates[i]) - new Date(dates[i - 1])) / 86400000 >= 21) { comeback = true; break; }
    }
    const byMonth = {};
    dates.forEach((d) => { const k = d.slice(0, 7); byMonth[k] = (byMonth[k] || 0) + 1; });
    const ironMonth = Object.values(byMonth).some((n) => n >= 12);
    // Single-day volume (10k-lb day)
    const dayVolume = {};
    Object.values(progress?.exerciseLogs || {}).forEach((ls) => (ls || []).forEach((l) => {
      if (!l.date) return;
      (l.sets || []).forEach((s) => {
        const w = parseFloat(s.weight), r = parseInt(s.reps) || 0;
        if (isFinite(w) && w > 0 && r) dayVolume[l.date] = (dayVolume[l.date] || 0) + w * r;
      });
    }));
    const tenKDay = Object.values(dayVolume).some((v) => v >= 10000);
    const cardioCount = (progress?.cardioLogs || []).length;
    // Bodyweight-ratio ladder on the big lifts
    const bw = latestBodyweight(progress, client);
    const bigLift = bestBigThreeLift(progress, client);
    const ratioPct = bw && bigLift ? Math.round((bigLift / bw) * 100) : 0;
    const bwHint = (pct) => bw
      ? `Put ${pct}% of your bodyweight on the bar: squat, bench, deadlift, or pulldown. Best so far: ${ratioPct}%`
      : `Put ${pct}% of your bodyweight on the bar: squat, bench, deadlift, or pulldown. Log your bodyweight first!`;
    const pullups = bestPullupReps(progress, client);
    const puHint = (n) => `Do ${n} pull-up${n === 1 ? "" : "s"} in one set${pullups ? `. Best so far: ${pullups}` : ""}`;
    return [
      { icon: "🥇", name: "First workout", hint: "Complete your first workout", earned: workouts >= 1 },
      { icon: "🔟", name: "10 workouts", hint: "Complete 10 workouts", earned: workouts >= 10 },
      { icon: "🎯", name: "25 workouts", hint: "Complete 25 workouts", earned: workouts >= 25 },
      { icon: "💪", name: "50 workouts", hint: "Complete 50 workouts", earned: workouts >= 50 },
      { icon: "👑", name: "100 workouts", hint: "Complete 100 workouts", earned: workouts >= 100 },
      { icon: "🗿", name: "250 workouts", hint: "Complete 250 workouts", earned: workouts >= 250 },
      { icon: "🏆", name: "First PR", hint: "Log your first personal record", earned: prCount >= 1 },
      { icon: "⚡", name: "5 PRs", hint: "Log 5 personal records", earned: prCount >= 5 },
      { icon: "⚔️", name: "10 PRs", hint: "Log 10 personal records", earned: prCount >= 10 },
      { icon: "🔥", name: "4-week streak", hint: "Train 4 weeks in a row", earned: streak >= 4 },
      { icon: "☄️", name: "8-week streak", hint: "Train 8 weeks in a row", earned: streak >= 8 },
      { icon: "🗓️", name: "Iron month", hint: "12 workouts in one calendar month", earned: ironMonth },
      { icon: "🦅", name: "Comeback", hint: "Return after 3+ weeks away", earned: comeback },
      { icon: "🔨", name: "10k day", hint: "Move 10,000 lb of volume in a single workout", earned: tenKDay },
      { icon: "🏃", name: "Engine builder", hint: "Log 10 cardio sessions", earned: cardioCount >= 10 },
      { icon: "🌱", name: "½ bodyweight", hint: bwHint(50), earned: ratioPct >= 50 },
      { icon: "🪨", name: "¾ bodyweight", hint: bwHint(75), earned: ratioPct >= 75 },
      { icon: "🦍", name: "Bodyweight club", hint: bwHint(100), earned: ratioPct >= 100 },
      { icon: "🐂", name: "1.25× bodyweight", hint: bwHint(125), earned: ratioPct >= 125 },
      { icon: "🦏", name: "1.5× bodyweight", hint: bwHint(150), earned: ratioPct >= 150 },
      { icon: "🐻", name: "1.75× bodyweight", hint: bwHint(175), earned: ratioPct >= 175 },
      { icon: "🐉", name: "2× bodyweight", hint: bwHint(200), earned: ratioPct >= 200 },
      { icon: "🐒", name: "First pull-up", hint: puHint(1), earned: pullups >= 1 },
      { icon: "🧗", name: "5 pull-ups", hint: puHint(5), earned: pullups >= 5 },
      { icon: "🦾", name: "10 pull-ups", hint: puHint(10), earned: pullups >= 10 },
      { icon: "🦸", name: "20 pull-ups", hint: puHint(20), earned: pullups >= 20 },
      { icon: "🏋️", name: "100k club", hint: "Lift 100,000 lb lifetime", earned: ton >= 100000 },
      { icon: "⛰️", name: "500k club", hint: "Lift 500,000 lb lifetime", earned: ton >= 500000 },
      { icon: "🌋", name: "Million-lb club", hint: "Lift 1,000,000 lb lifetime", earned: ton >= 1000000 },
    ];
  }
  // Draws the lifetime stats as a 1080×1080 brand card and shares/downloads it.
  async function shareLifetimeImage(stats0, name) {
    const cv = document.createElement("canvas");
    cv.width = 1080; cv.height = 1080;
    const x = cv.getContext("2d");
    const g = x.createLinearGradient(0, 0, 0, 1080);
    g.addColorStop(0, "#0c1322"); g.addColorStop(1, "#060a13");
    x.fillStyle = g; x.fillRect(0, 0, 1080, 1080);
    x.textAlign = "center";
    x.fillStyle = "#22d3ee"; x.font = "800 46px system-ui, sans-serif";
    x.fillText("STONE DRAGON STRENGTH", 540, 116);
    x.fillStyle = "#94a3b8"; x.font = "600 40px system-ui, sans-serif";
    x.fillText(`Lifetime stats: ${(name || "athlete").trim().split(/\s+/)[0]}`, 540, 186);
    const stats = [
      [String(stats0.workouts), "WORKOUTS"],
      [String(stats0.prs), "PERSONAL RECORDS"],
      [formatTonnage(stats0.volume) + " lb", "TOTAL LIFTED"],
    ];
    let y = 400;
    stats.forEach(([num, lbl]) => {
      x.fillStyle = "#e2e8f0"; x.font = "800 128px system-ui, sans-serif";
      x.fillText(num, 540, y);
      x.fillStyle = "#64748b"; x.font = "700 36px system-ui, sans-serif";
      x.fillText(lbl, 540, y + 58);
      y += 235;
    });
    x.fillStyle = "#22d3ee"; x.font = "600 32px system-ui, sans-serif";
    x.fillText("stonedragonstrengthtraining.com", 540, 1014);
    const blob = await new Promise((res) => cv.toBlob(res, "image/png"));
    if (!blob) return;
    const file = new File([blob], "stone-dragon-lifetime.png", { type: "image/png" });
    try {
      if (navigator.canShare && navigator.canShare({ files: [file] })) {
        await navigator.share({ files: [file], title: "My lifetime lifting stats" });
        return;
      }
    } catch (e) { if (e?.name === "AbortError") return; }
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob); a.download = file.name; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    toast("Stats image downloaded");
  }

  // -------- Auto-PR detection at lock-in --------
  // Compares the just-locked top set against every earlier session of the
  // same exercise NAME (weeks duplicate exercises under new ids). A heavier
  // top set — or more reps at the same weight — celebrates on the spot and
  // writes an entry into the athlete's PR list.
  // Decide whether the just-locked entry set a personal record, and if so file
  // one. Weighted lifts are judged by estimated 1RM (so rep PRs count too);
  // bodyweight lifts by reps. Matching uses exKey() so renames/typos don't
  // split history, and warm-ups/skipped sets never count.
  function detectAndCelebratePR(ex, entry, cardEl) {
    const name = (ex.name || "").trim();
    // Timed carries are excluded — seconds would read as reps in e1RM math.
    if (!name || ex.kind === "mobility" || exIsTimed(ex)) return;
    const key = exKey(name);
    const logs = state.clientData.progress.exerciseLogs || {};
    const workingSets = (l) => (l.sets || []).filter((s) => !s.skipped);
    // Written "BW", but once a BW lift graduates the athlete logs real weight —
    // judge those by e1RM (weighted), not reps. Any loaded working set = weighted.
    const bw = ex.currentWeight === "BW" && !workingSets(entry).some((s) => (parseFloat(s.weight) || 0) > 0);

    // Best of today's working sets — score = e1RM (weighted) or reps (BW).
    let cur = null; // { score, weight, reps }
    workingSets(entry).forEach((s) => {
      const r = parseInt(s.reps, 10) || 0;
      if (bw) {
        if (r > 0 && (!cur || r > cur.score)) cur = { score: r, weight: "BW", reps: r };
      } else {
        const w = parseFloat(s.weight);
        if (isFinite(w) && w > 0 && r > 0) {
          const e = epley1RM(w, r);
          if (!cur || e > cur.score) cur = { score: e, weight: String(w), reps: r };
        }
      }
    });
    if (!cur) return;

    // Prior best across every copy of this lift (by key), minus the set judged.
    // One-off coach sessions count both ways: a heavy session lift PRs against
    // program history, and program lifts are judged against session bests.
    let prev = null;
    [...(state.clientData.program?.client?.weeks || []), { days: state.clientData.program?.client?.oneOffDays || [] }].forEach((wk) => (wk.days || []).forEach((d) => (d.exercises || []).forEach((e2) => {
      if (exKey(e2.name) !== key) return;
      (logs[e2.id] || []).forEach((l) => {
        if (e2.id === ex.id && l.date === entry.date) return; // the set being judged
        workingSets(l).forEach((s) => {
          const r = parseInt(s.reps, 10) || 0;
          if (bw) { if (r > 0 && (prev == null || r > prev)) prev = r; }
          else { const w = parseFloat(s.weight); if (isFinite(w) && w > 0 && r > 0) { const e = epley1RM(w, r); if (prev == null || e > prev) prev = e; } }
        });
      });
    })));
    if (prev == null) return;                 // first time doing this lift
    if (cur.score <= prev + 0.01) return;     // didn't beat the prior best
    // Fat-finger guard (135 → 1350): skip the auto-award on an implausible
    // one-session jump. It can still be added by hand.
    if (!bw && cur.score > prev * 1.4) return;

    const prs = state.clientData.progress.personalRecords || (state.clientData.progress.personalRecords = []);
    if (prs.some((p) => exKey(p.name) === key && p.date === entry.date && String(p.weight) === String(cur.weight) && String(p.reps) === String(cur.reps))) return;
    prs.push(makePR({ name, weight: cur.weight, reps: String(cur.reps), date: entry.date, notes: "Auto-detected during workout 🎉", auto: true }));
    if (cardEl) celebrateElement(cardEl, "pr-celebrate");
    toast(`🎉 New PR · ${name}: ${bw ? cur.reps + " reps" : cur.weight + (isDumbbellLift(name) ? "s × " : " lb × ") + cur.reps}!`, 3500);
  }

  // -------- Guided tour (spotlight walkthrough) --------
  // A dimmed overlay whose glowing cutout glides between real UI elements,
  // with a floating card explaining each stop. Steps are plain data:
  // { sel, go, title, text } — go() runs first (switching tab/view), and a
  // step whose target is missing or hidden is skipped, so tours degrade
  // gracefully on empty accounts. Auto-runs once per device (doneKey);
  // replayable from the ? button in either header.
  const KEY_TOUR_COACH = "trainerpro_tour_coach_v1";
  const KEY_TOUR_ATHLETE = "trainerpro_tour_athlete_v1";
  let _tour = null;

  // onEnd runs when the tour closes (finish OR skip) — used to tear down the
  // temporary demo program the athlete tour stands up on an empty account.
  function startTour(steps, doneKey, onEnd) {
    endTour(false);
    if (!steps?.length) { onEnd?.(); return; }
    const wrap = document.createElement("div");
    wrap.className = "tour-wrap"; // full-screen shield: blocks app clicks mid-tour
    const spot = document.createElement("div");
    spot.className = "tour-spot";
    const card = document.createElement("div");
    card.className = "tour-card";
    wrap.appendChild(spot);
    wrap.appendChild(card);
    document.body.appendChild(wrap);
    _tour = { steps, i: -1, wrap, spot, card, doneKey, onEnd };
    window.addEventListener("resize", _tourRepos);
    document.addEventListener("keydown", _tourKeys);
    showTourStep(0, 1);
  }
  function endTour(markDone) {
    const t = _tour;
    if (!t) return;
    _tour = null;
    window.removeEventListener("resize", _tourRepos);
    document.removeEventListener("keydown", _tourKeys);
    t.wrap.remove();
    // Skip also marks done — a dismissed tour shouldn't nag on next boot.
    if (markDone !== false && t.doneKey) localStorage.setItem(t.doneKey, "1");
    if (t.onEnd) t.onEnd(); // restore real program / clear demo state
  }
  function _tourRepos() { if (_tour) _positionTourStep(); }
  function _tourKeys(e) {
    if (!_tour) return;
    if (e.key === "Escape") endTour(true);
    else if (e.key === "ArrowRight") showTourStep(_tour.i + 1, 1);
    else if (e.key === "ArrowLeft") showTourStep(_tour.i - 1, -1);
  }
  function showTourStep(i, dir) {
    const t = _tour; if (!t) return;
    // Walk in `dir` until a step's target exists and is visible on screen.
    while (i >= 0 && i < t.steps.length) {
      const s = t.steps[i];
      if (s.go) s.go();
      const el = $(s.sel);
      if (el && el.offsetParent !== null) break;
      i += dir;
    }
    if (i < 0) i = 0;
    if (i >= t.steps.length) { endTour(true); toast("Tour complete ✓"); return; }
    t.i = i;
    const s = t.steps[i];
    $(s.sel).scrollIntoView({ block: "center" });
    t.card.innerHTML = `
      <div class="tour-count">${i + 1} / ${t.steps.length}</div>
      <h4>${escapeHtml(s.title)}</h4>
      <p>${escapeHtml(s.text)}</p>
      <div class="tour-nav">
        <button type="button" class="tour-skip">Skip</button>
        <span class="tour-nav-right">
          ${i > 0 ? `<button type="button" class="tour-back">← Back</button>` : ""}
          <button type="button" class="tour-next">${i === t.steps.length - 1 ? "Done ✓" : "Next →"}</button>
        </span>
      </div>`;
    t.card.querySelector(".tour-skip").addEventListener("click", () => endTour(true));
    t.card.querySelector(".tour-back")?.addEventListener("click", () => showTourStep(t.i - 1, -1));
    t.card.querySelector(".tour-next").addEventListener("click", () => showTourStep(t.i + 1, 1));
    // Position after the tab switch renders and the scroll settles.
    requestAnimationFrame(() => setTimeout(_positionTourStep, 80));
  }
  function _positionTourStep() {
    const t = _tour; if (!t) return;
    const s = t.steps[t.i];
    const el = s && $(s.sel);
    if (!el || el.offsetParent === null) return;
    const pad = 8;
    const r = el.getBoundingClientRect();
    const vw = window.innerWidth, vh = window.innerHeight;
    const top = Math.max(r.top - pad, 4), left = Math.max(r.left - pad, 4);
    const w = Math.min(r.width + pad * 2, vw - 8), h = Math.min(r.height + pad * 2, vh - 8);
    Object.assign(t.spot.style, { top: top + "px", left: left + "px", width: w + "px", height: h + "px" });
    // Card below the spotlight when there's room, else above, else pinned low.
    const c = t.card;
    const cw = Math.min(320, Math.round(vw * 0.88));
    c.style.width = cw + "px";
    const ch = c.offsetHeight || 170;
    let cy, caret;
    if (top + h + ch + 20 < vh) { cy = top + h + 14; caret = "top"; }
    else if (top - ch - 14 > 4) { cy = top - ch - 14; caret = "bottom"; }
    else { cy = vh - ch - 12; caret = "none"; }
    const cx = Math.min(Math.max(left + w / 2 - cw / 2, 10), Math.max(vw - cw - 10, 10));
    c.classList.remove("caret-top", "caret-bottom", "caret-none");
    c.classList.add("caret-" + caret);
    c.style.setProperty("--caret-x", Math.min(Math.max(left + w / 2 - cx, 22), cw - 22) + "px");
    Object.assign(c.style, { top: cy + "px", left: cx + "px" });
  }

  // A throwaway one-day program the athlete tour stands up when the athlete
  // has no real program yet, so the "logging" stops always have a real rep
  // sheet to point at. Never saved (saveClient no-ops while state.tourDemo).
  function demoTourProgram() {
    const real = state.clientData?.program;
    return {
      clientId: real?.clientId,
      client: {
        ...(real?.client || {}),
        weeks: [{
          id: "__tour_wk", label: "Sample week", focus: "Full body", phaseLabel: "Demo", diet: {},
          days: [{
            id: "__tour_day", name: "Sample Day", exercises: [
              { id: "__tour_ex1", name: "Goblet Squat", sets: "3", currentWeight: "40", currentReps: "10", progression: { ceil: 12, inc: 5 }, notes: "Just a sample. This day disappears when the tour ends.", videoUrl: "" },
              { id: "__tour_ex2", name: "Push-Up", sets: "3", currentWeight: "BW", currentReps: "10", notes: "", videoUrl: "" },
              { id: "__tour_ex3", name: "Dumbbell Row", sets: "3", currentWeight: "35", currentReps: "12", notes: "", videoUrl: "" },
            ],
          }],
        }],
      },
    };
  }

  // Athlete tour entry point: on an empty account, swap in the demo program
  // for the tour's duration and restore it (untouched) when the tour closes.
  function beginAthleteTour() {
    let hasReal = false;
    for (const w of state.clientData?.program?.client?.weeks || []) {
      if ((w.days || []).some((d) => d.exercises?.length)) { hasReal = true; break; }
    }
    let onEnd = null;
    if (!hasReal) {
      const savedProgram = state.clientData.program;
      const savedView = state.workoutView;
      state.tourDemo = true; // freezes saveClient — the demo never persists
      state.clientData.program = demoTourProgram();
      renderClientWorkouts(); // picker shows the sample day
      onEnd = () => {
        state.tourDemo = false;
        state.clientData.program = savedProgram;
        state.workoutView = savedView || { mode: "picker" };
        renderClientWorkouts();
        setClientTab("overview");
      };
    }
    startTour(athleteTourSteps(), KEY_TOUR_ATHLETE, onEnd);
  }

  function athleteTourSteps() {
    // First day with exercises → the rep-sheet stops have something real to
    // point at (a real program, or the demo one beginAthleteTour stands up).
    let pos = null;
    for (const w of state.clientData?.program?.client?.weeks || []) {
      for (const d of w.days || []) {
        if (d.exercises?.length) { pos = { weekId: w.id, dayId: d.id }; break; }
      }
      if (pos) break;
    }
    const goDetail = pos && (() => {
      setClientTab("workouts");
      if (state.workoutView?.mode !== "detail" || state.workoutView.dayId !== pos.dayId) {
        state.workoutView = { mode: "detail", weekId: pos.weekId, dayId: pos.dayId, date: todayISO() };
        renderWorkoutDetailUI();
      }
    });
    return [
      { sel: "#screen-client .tabs", go: () => setClientTab("overview"),
        title: "Welcome to Stone Dragon", text: "A quick lap around your training hub, about a minute. Skip any time. These tabs are everything." },
      { sel: '[data-ctab-panel="overview"]',
        title: "Overview", text: "Your streak, last workout, lifetime totals, charts and trophies. It fills in as you train — tap ⋯ on the stats card to pick what shows, like cardio time, distance, or total push-ups and pull-ups." },
      { sel: '[data-ctab-panel="workouts"]', go: () => setClientTab("workouts"),
        title: "Your program", text: "Everything your coach wrote for you. Tap a day to open the session and start logging." },
      { sel: ".workout-detail-list .cex-set-table", go: goDetail,
        title: "Logging sets", text: "Tap a box to accept the day's target (it turns blue), or type and use the ▲▼ arrows to adjust. It saves as you go." },
      { sel: ".workout-detail-list button.cex-set-lbl", go: goDetail,
        title: "Skip a set", text: "Didn't do one? Tap its label (S1, S2…) to mark it skipped. Honest data beats zeros." },
      { sel: ".workout-detail-list .cex-skip-btn", go: goDetail,
        title: "Skip an exercise", text: "Had to pass on the whole thing? One tap here records it as skipped, and your day can still complete." },
      { sel: ".workout-detail-list .cex-lock-btn", go: goDetail,
        title: "Locking in", text: "Fill every set and the exercise locks itself — green check, done. Tap 🔒 to lock early and untouched boxes fill with the plan. ✎ Edit reopens it if you need to change something. Finish every exercise and the whole day celebrates." },
      { sel: "#rest-timer-btn", go: goDetail,
        title: "Rest timer", text: "Tap Go to start your rest. It dings when it's time to lift, then rolls straight into the next rest until you stop it. The small time button picks the length, the bell mutes the ding." },
      { sel: '[data-ctab-panel="prs"]', go: () => setClientTab("prs"),
        title: "Personal records", text: "Your PRs live here. Locking a heavy set can raise them automatically." },
      { sel: "#client-feedback", go: () => setClientTab("diet"),
        title: "Nutrition, cardio & notes", text: "Coach's nutrition targets and your cardio log — record the minutes and, if you tracked it, the distance. This note box goes straight to your coach." },
      { sel: '[data-ctab-panel="sessions"]', go: () => setClientTab("sessions"),
        title: "Sessions", text: "Your session packages, bookings and open slots with your coach." },
      { sel: "#btn-tour-client", go: () => setClientTab("overview"),
        title: "That's the lap", text: "Replay this tour any time from this button. Now go lift something heavy." },
    ];
  }
  function coachTourSteps() {
    return [
      { sel: "#coach-nav", go: () => showCoachOverview(),
        title: "Welcome, coach", text: "A quick lap around the app, about a minute. Skip any time. This nav is home base." },
      { sel: "#view-overview",
        title: "Overview", text: "Every athlete on one calendar: completed days, sessions, open slots and incoming requests. When someone logs a workout it shows up top under New activity." },
      { sel: "#client-grid", go: () => renderDashboard(),
        title: "Your athletes", text: "One card per athlete. Tap a card for their profile, program, nutrition, PRs and sessions." },
      { sel: "#client-grid .client-row-view",
        title: "Live fill-out", text: "This button drops you into their workout to log sets together, rest timer included. Everything saves to their account." },
      { sel: "#view-programs", go: () => { state.currentClientId = null; renderProgramsList(); },
        title: "Programs", text: "Build programs and day templates once, reuse them across athletes. Built one straight into an athlete instead? Save to Library on their Program tab brings a copy back here." },
      { sel: "#view-messages", go: () => { switchCoachView("messages"); renderMessagesView(); },
        title: "Messages", text: "Chat with your athletes, or post a bulletin everyone sees." },
      { sel: "#btn-export-data", go: () => openCoachProfile(),
        title: "Back up your data", text: "Download everything — athletes, their programs and logged history, and your program library — as one file, and restore it here if you ever need to. Worth grabbing one now and then." },
      { sel: "#btn-tour-coach", go: () => showCoachOverview(),
        title: "That's the lap", text: "Replay this tour any time from this button." },
    ];
  }

  // -------- Rest timer (athlete workout detail) --------
  let _restEnd = 0, _restIv = null;
  // End-of-rest ding. iPads/tablets refuse audio that wasn't unlocked by a
  // touch, so the shared AudioContext is created/resumed inside the tap that
  // starts the timer — by the time it dings, audio is already unlocked.
  const KEY_REST_SOUND = "trainerpro_rest_sound_v1";
  let _restAC = null;
  function restSoundOn() { return localStorage.getItem(KEY_REST_SOUND) !== "0"; }
  function unlockRestAudio() {
    try {
      const AC = window.AudioContext || window.webkitAudioContext; if (!AC) return;
      if (!_restAC) _restAC = new AC();
      if (_restAC.state === "suspended") _restAC.resume();
    } catch (e) {}
  }
  // Chosen rest length persists — the Go button reuses it and the timer
  // auto-repeats with it after every ding until the athlete taps Stop.
  const KEY_REST_DUR = "trainerpro_rest_dur_v1";
  function restDur() {
    const v = parseInt(localStorage.getItem(KEY_REST_DUR), 10);
    return Number.isFinite(v) && v > 0 ? v : 90;
  }
  function fmtRest(sec) { return `${Math.floor(sec / 60)}:${String(sec % 60).padStart(2, "0")}`; }
  function refreshRestOptBtn() {
    const b = $("#rest-timer-opt-btn"); if (b) b.textContent = fmtRest(restDur());
  }
  function showRestTimer() { const w = $("#rest-timer"); if (w) show(w); refreshRestOptBtn(); showDayProgress(); }
  function hideRestTimer() {
    stopRestTimer(false);
    const w = $("#rest-timer"); if (w) hide(w);
    $("#rest-timer-pop")?.classList.add("hidden");
    hideDayProgress();
  }
  function startRestTimer(sec) {
    if (restSoundOn()) unlockRestAudio(); // user gesture — unlock the ding now
    _restEnd = Date.now() + sec * 1000;
    clearInterval(_restIv);
    $("#rest-timer-btn")?.classList.add("running");
    _restIv = setInterval(tickRestTimer, 250);
    tickRestTimer();
    $("#rest-timer-pop")?.classList.add("hidden");
  }
  function stopRestTimer(finished) {
    clearInterval(_restIv); _restIv = null; _restEnd = 0;
    const btn = $("#rest-timer-btn");
    if (!btn) return;
    btn.classList.remove("running");
    btn.textContent = "▶ Go";
  }
  function tickRestTimer() {
    const btn = $("#rest-timer-btn"); if (!btn) return;
    const left = Math.ceil((_restEnd - Date.now()) / 1000);
    if (left <= 0) {
      // Ding, then roll straight into the next rest — the timer loops with the
      // same duration until the athlete taps Stop (or leaves the day).
      try { navigator.vibrate?.([200, 100, 200]); } catch (e) {}
      restBeep();
      btn.classList.add("done-flash");
      setTimeout(() => btn.classList.remove("done-flash"), 1600);
      _restEnd = Date.now() + restDur() * 1000;
    }
    const l2 = Math.max(0, Math.ceil((_restEnd - Date.now()) / 1000));
    btn.textContent = `⏹ ${fmtRest(l2)}`;
  }
  function restBeep() {
    if (!restSoundOn()) return;
    try {
      unlockRestAudio();
      const ac = _restAC; if (!ac) return;
      // Two-tone "ding": 880 Hz then 1175 Hz, on the shared unlocked context.
      [[880, 0], [1175, 220]].forEach(([hz, delay]) => {
        setTimeout(() => {
          try {
            const o = ac.createOscillator(); const g = ac.createGain();
            o.connect(g); g.connect(ac.destination);
            o.frequency.value = hz; g.gain.value = 0.08;
            o.start();
            setTimeout(() => { try { o.stop(); } catch (e) {} }, 300);
          } catch (e) {}
        }, delay);
      });
    } catch (e) {}
  }

  // -------- Coach: money strip + last-activity helpers --------
  function lastActivityISO(p) {
    if (!p) return null;
    let last = null;
    const consider = (d) => { if (d && (!last || d > last)) last = d; };
    Object.values(p.exerciseLogs || {}).forEach((ls) => (ls || []).forEach((l) => consider(l.date)));
    Object.values(p.dayCompletions || {}).forEach((v) => (Array.isArray(v) ? v : []).forEach(consider));
    (p.bodyweightLog || []).forEach((b) => consider(b.date));
    (p.cardioLogs || []).forEach((l) => consider(l.date));
    return last;
  }
  // No dollar figures on the overview (2026-07-17, per Nathan) — just a quiet
  // "who owes" chip so unpaid packages still surface somewhere.
  // -------- Modal --------
  function openModal({ title, body, actions = [] }) {
    $("#modal-title").textContent = title;
    $("#modal-body").innerHTML = body;
    const foot = $("#modal-foot");
    foot.innerHTML = "";
    for (const a of actions) {
      const btn = document.createElement("button");
      btn.className = a.className || "btn";
      btn.textContent = a.label;
      btn.addEventListener("click", a.onClick);
      foot.appendChild(btn);
    }
    show($("#modal"));
  }
  function closeModal() { hide($("#modal")); }

  // -------- Bug reports --------
  // bugreport.js silently records diagnostics (errors, console, taps); this is
  // the submit UI on both sides plus the coach-side viewer. Reports filed
  // offline queue in localStorage and send on the next online open.
  const KEY_BUG_QUEUE = "trainerpro_bug_queue_v1";

  function bugReportIdentity() {
    if (state.mode === "trainer") {
      const t = state.trainerData?.trainer || {};
      return { role: "coach", name: t.name || "Coach", athleteId: null };
    }
    const c = state.clientData?.program?.client;
    if (c) return { role: "athlete", name: c.name || "", athleteId: c.id || null };
    return { role: "login", name: "", athleteId: null };
  }

  async function sendBugReport(report) {
    if (window.Cloud?.enabled && navigator.onLine) {
      if (await Cloud.submitBugReport(report)) return true;
    }
    try {
      const q = JSON.parse(localStorage.getItem(KEY_BUG_QUEUE) || "[]");
      q.push(report);
      localStorage.setItem(KEY_BUG_QUEUE, JSON.stringify(q.slice(-5)));
    } catch (e) { /* storage full — the toast already says it may not send */ }
    return false;
  }

  async function flushBugQueue() {
    if (!window.Cloud?.enabled || !navigator.onLine) return;
    let q = [];
    try { q = JSON.parse(localStorage.getItem(KEY_BUG_QUEUE) || "[]"); } catch (e) {}
    if (!q.length) return;
    localStorage.removeItem(KEY_BUG_QUEUE);
    const failed = [];
    for (const r of q) if (!(await Cloud.submitBugReport(r))) failed.push(r);
    if (failed.length) {
      try { localStorage.setItem(KEY_BUG_QUEUE, JSON.stringify(failed)); } catch (e) {}
    }
  }

  function openBugReportModal() {
    const diag = window.BugReport ? window.BugReport.snapshot() : {};
    const errCount = (diag.errors || []).length;
    openModal({
      title: "Report a problem",
      body: `
        <p class="muted">Say what you were doing and what went wrong. A snapshot of recent app activity${errCount ? ` (${errCount} error${errCount === 1 ? "" : "s"} caught)` : ""} is attached automatically. Nothing you typed is included.</p>
        <textarea id="bug-desc" rows="5" placeholder="e.g. Tapped Log set on bench press and the button did nothing"></textarea>`,
      actions: [
        { label: "Cancel", className: "btn btn-ghost", onClick: closeModal },
        {
          label: "Send report", className: "btn btn-primary",
          onClick: async () => {
            const description = ($("#bug-desc")?.value || "").trim();
            if (!description) { toast("Add a line about what happened first"); return; }
            const report = { ...bugReportIdentity(), description: description.slice(0, 5000), diagnostics: diag };
            closeModal();
            const sent = await sendBugReport(report);
            toast(sent ? "Report sent. Thank you! 🐞" : "Saved. It will send next time you're online.", 2600);
          },
        },
      ],
    });
    $("#bug-desc")?.focus();
  }

  function bugWhen(iso) {
    const d = new Date(iso);
    const min = Math.round((Date.now() - d.getTime()) / 60000);
    if (min < 1) return "just now";
    if (min < 60) return `${min}m ago`;
    if (min < 60 * 24) return `${Math.round(min / 60)}h ago`;
    return d.toLocaleDateString(undefined, { month: "short", day: "numeric" }) +
      " " + d.toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
  }

  function bugDiagHtml(d) {
    if (!d || typeof d !== "object") return "";
    const lines = (arr, fmt) => (arr || []).map((x) => escapeHtml(fmt(x))).join("\n");
    const errs = lines(d.errors, (e) => `${e.t || ""} [${e.kind || "error"}] ${e.msg || ""}${e.src ? ` (${e.src})` : ""}${e.stack ? `\n    ${e.stack}` : ""}`);
    const prev = d.prevSessionErrors?.errors?.length
      ? lines(d.prevSessionErrors.errors, (e) => `${e.t || ""} ${e.msg || ""}`)
      : "";
    const cons = lines(d.console, (c) => `${c.t || ""} ${c.level || ""}: ${c.msg || ""}`);
    const tapsTxt = lines(d.taps, (t) => `${t.t || ""} ${t.on || ""} → ${t.el || ""}`);
    const meta = [
      d.version && `v ${d.version}`,
      d.screen,
      d.standalone ? "installed PWA" : "browser",
      d.online === false ? "was offline" : "",
      d.visibleScreen && `on ${d.visibleScreen} screen`,
      d.sessionAgeSec != null && `app open ${Math.max(1, Math.round(d.sessionAgeSec / 60))}m`,
    ].filter(Boolean).join(" · ");
    const sec = (label, txt) => txt
      ? `<div class="bug-diag-sec"><span class="bug-diag-lbl">${label}</span><pre>${txt}</pre></div>`
      : "";
    return `
      <div class="bug-diag-meta">${escapeHtml(meta)}</div>
      <div class="bug-diag-meta">${escapeHtml(d.userAgent || "")}</div>
      ${sec(`Errors (${(d.errors || []).length})`, errs)}
      ${prev ? sec("Errors from the previous session, before a reload", prev) : ""}
      ${sec("Console warnings", cons)}
      ${sec("Last taps", tapsTxt)}`;
  }

  async function openBugReportsViewer() {
    openModal({
      title: "Bug reports",
      body: `<div id="bug-reports-list"><p class="muted">Loading…</p></div>`,
      actions: [{ label: "Close", className: "btn btn-ghost", onClick: closeModal }],
    });
    const host = $("#bug-reports-list");
    if (!window.Cloud?.enabled) {
      host.innerHTML = `<p class="muted">Cloud sync is off, so reports can't be fetched.</p>`;
      return;
    }
    const reports = await Cloud.getBugReports();
    if (!reports) {
      host.innerHTML = `<p class="muted">Couldn't load reports. Check your connection and try again.</p>`;
      return;
    }
    renderBugReports(host, reports);
  }

  function renderBugReports(host, reports) {
    if (!reports.length) {
      host.innerHTML = `<p class="muted">No reports. Quiet is good. 🐉</p>`;
      return;
    }
    host.innerHTML = reports.map((r) => {
      const errN = (r.diagnostics?.errors || []).length;
      return `
      <div class="bug-report" data-bug-id="${escapeHtml(r.id)}">
        <div class="bug-report-head">
          <div>
            <strong>${escapeHtml(r.reporter_name || "Unknown")}</strong>
            <span class="muted">${escapeHtml(r.reporter_role || "")} · ${escapeHtml(bugWhen(r.created_at))}${errN ? ` · ${errN} error${errN === 1 ? "" : "s"}` : ""}</span>
          </div>
          <button class="icon-btn" data-bug-del title="Delete report">×</button>
        </div>
        <p class="bug-report-desc">${escapeHtml(r.description || "")}</p>
        <details class="bug-report-details"><summary>Diagnostics</summary>${bugDiagHtml(r.diagnostics)}</details>
      </div>`;
    }).join("");
    host.querySelectorAll("[data-bug-del]").forEach((btn) => btn.addEventListener("click", async () => {
      const wrap = btn.closest(".bug-report");
      const id = wrap?.dataset.bugId;
      if (!id) return;
      btn.disabled = true;
      if (await Cloud.deleteBugReport(id)) {
        wrap.remove();
        if (!host.querySelector(".bug-report")) renderBugReports(host, []);
      } else {
        btn.disabled = false;
        toast("Couldn't delete. Try again.");
      }
    }));
  }

  // -------- Web push (athlete notifications) --------
  // The athlete opts in from Profile → 🔔. Their browser subscription is
  // stored per-device in Supabase (push_subscriptions, RLS: athlete-owned);
  // the coach's bulletins and nudges go out via the send-push Edge Function.
  const KEY_PUSH = "trainerpro_push_v1"; // "1" = this device opted in
  function pushSupported() {
    return "serviceWorker" in navigator && "PushManager" in window && "Notification" in window;
  }
  function urlB64ToUint8Array(b64) {
    const pad = "=".repeat((4 - (b64.length % 4)) % 4);
    const base = (b64 + pad).replace(/-/g, "+").replace(/_/g, "/");
    const raw = atob(base);
    return Uint8Array.from([...raw].map((ch) => ch.charCodeAt(0)));
  }
  async function subscribePush() {
    const athleteId = state.clientData.program?.clientId;
    const vapid = window.STONE_DRAGON_CONFIG?.VAPID_PUBLIC_KEY;
    if (!athleteId || !vapid || !window.Cloud?.enabled || !pushSupported()) return false;
    const perm = await Notification.requestPermission();
    if (perm !== "granted") return false;
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlB64ToUint8Array(vapid),
      });
      const ok = await window.Cloud.savePushSubscription(athleteId, sub.toJSON());
      if (ok) localStorage.setItem(KEY_PUSH, "1");
      return ok;
    } catch (e) { console.warn("[Push] subscribe failed", e); return false; }
  }
  async function unsubscribePush() {
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = await reg.pushManager.getSubscription();
      if (sub) {
        await window.Cloud?.deletePushSubscription?.(sub.endpoint);
        await sub.unsubscribe();
      }
    } catch (e) {}
    localStorage.removeItem(KEY_PUSH);
  }
  // Endpoints rotate — silently re-assert the subscription on portal entry.
  async function refreshPushSubscription() {
    if (state.previewMode) return;
    if (localStorage.getItem(KEY_PUSH) !== "1") return;
    if (!pushSupported() || Notification.permission !== "granted") return;
    const vapid = window.STONE_DRAGON_CONFIG?.VAPID_PUBLIC_KEY;
    const athleteId = state.clientData.program?.clientId;
    if (!vapid || !athleteId || !window.Cloud?.enabled) return;
    try {
      const reg = await navigator.serviceWorker.ready;
      const sub = (await reg.pushManager.getSubscription()) ||
        (await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: urlB64ToUint8Array(vapid) }));
      await window.Cloud.savePushSubscription(athleteId, sub.toJSON());
    } catch (e) {}
  }
  function renderAthleteNotifyCard() {
    const host = $("#athlete-notify-host");
    if (!host) return;
    if (state.previewMode) { host.innerHTML = ""; return; } // coach preview: not their device
    const supported = pushSupported();
    const enabled = supported && Notification.permission === "granted" && localStorage.getItem(KEY_PUSH) === "1";
    const blocked = supported && Notification.permission === "denied";
    const iosTip = /iphone|ipad|ipod/i.test(navigator.userAgent) && !isStandalone()
      ? `<p class="muted" style="font-size:0.8rem">On iPhone: install the app first (Share → Add to Home Screen), then enable here.</p>`
      : "";
    let inner;
    if (!supported) {
      inner = `<p class="muted">This browser doesn't support notifications.</p>`;
    } else if (blocked) {
      inner = `<p class="muted">Notifications are blocked for this site. Allow them in your browser settings, then come back.</p>`;
    } else {
      inner = `
        <p class="muted" style="font-size:0.85rem">Get a ping when your coach posts a bulletin or sends you a message.</p>
        ${iosTip}
        <button class="btn ${enabled ? "btn-ghost" : "btn-primary"} btn-sm" id="btn-toggle-push" type="button">${enabled ? "🔕 Turn off notifications" : "🔔 Enable notifications"}</button>`;
    }
    host.innerHTML = `<div class="card"><h4 style="margin-top:0">🔔 Notifications</h4>${inner}</div>`;
    $("#btn-toggle-push")?.addEventListener("click", async () => {
      const btn = $("#btn-toggle-push");
      if (btn) { btn.disabled = true; btn.textContent = "Working…"; }
      if (enabled) {
        await unsubscribePush();
        toast("Notifications off");
      } else {
        const ok = await subscribePush();
        toast(ok
          ? "Notifications on 🔔"
          : (Notification.permission === "denied"
            ? "Blocked. Allow notifications in your browser settings"
            : "Couldn't enable. Check your connection"), 3000);
      }
      renderAthleteNotifyCard();
    });
  }
  // Coach → one athlete: push a custom message to their phone.
  function openNudgeModal() {
    const c = currentClient(); if (!c) return;
    openModal({
      title: `🔔 Nudge ${c.name}`,
      body: `
        <p class="muted" style="margin-top:-0.4em">Sends a push notification to their phone. They need notifications enabled in their app (Profile → 🔔 Notifications).</p>
        <textarea id="nudge-text" rows="3" style="width:100%">Time to get back in the gym 💪</textarea>`,
      actions: [
        { label: "Cancel", className: "btn btn-ghost", onClick: closeModal },
        { label: "Send nudge", className: "btn btn-primary", onClick: async () => {
          const text = $("#nudge-text")?.value.trim();
          if (!text) return;
          closeModal();
          const res = await window.Cloud?.sendPush?.([c.id], "Stone Dragon Strength", text, "./");
          toast(res?.sent
            ? `Nudge sent to ${c.name} ✓`
            : `No devices reached. Has ${c.name} enabled notifications?`, 3500);
        } },
      ],
    });
  }

  // -------- Install to Home Screen (PWA) --------
  // Chrome/Android/desktop fire `beforeinstallprompt`, which we capture and
  // replay from our own button. iOS Safari has no such API — installing there
  // is a manual Share-sheet flow, so on iOS the button opens instructions.
  // Buttons carry class `install-app-btn` (login screen + athlete portal) and
  // stay hidden unless install is actually possible and not already installed.
  let _deferredInstallPrompt = null;

  function isStandalone() {
    return window.matchMedia("(display-mode: standalone)").matches ||
           window.navigator.standalone === true;
  }
  function isIOS() {
    const ua = navigator.userAgent || "";
    // iPadOS 13+ reports as "MacIntel" — distinguish it by touch support.
    const iPadOS = navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1;
    return /iPad|iPhone|iPod/.test(ua) || iPadOS;
  }
  function isAndroid() { return /Android/i.test(navigator.userAgent || ""); }
  function installPossible() {
    // Show the install CTA whenever a native prompt is queued OR we're on a
    // phone (where we can at least walk the user through the manual steps).
    return !!_deferredInstallPrompt || isIOS() || isAndroid();
  }
  function refreshInstallUI() {
    const shouldShow = !isStandalone() && installPossible();
    document.querySelectorAll(".install-app-btn").forEach((el) => {
      el.classList.toggle("hidden", !shouldShow);
    });
  }
  async function promptInstall() {
    if (_deferredInstallPrompt) {
      _deferredInstallPrompt.prompt();
      let outcome = "dismissed";
      try { ({ outcome } = await _deferredInstallPrompt.userChoice); } catch (_) {}
      _deferredInstallPrompt = null;
      refreshInstallUI();
      if (outcome === "accepted") toast("Installing Stone Dragon…");
      return;
    }
    if (isIOS()) { showIOSInstallInstructions(); return; }
    if (isAndroid()) { showAndroidInstallInstructions(); return; }
    toast("Open your browser menu and choose Install / Add to Home Screen");
  }
  function showAndroidInstallInstructions() {
    openModal({
      title: "Install the app",
      body: `
        <p class="muted" style="margin-top:-0.3em">Install Stone Dragon so it opens like an app, and works offline.</p>
        <ol class="install-steps">
          <li>Tap the <strong>⋮ menu</strong> in the top-right of your browser.</li>
          <li>Tap <strong>Install app</strong> (or <strong>Add to Home screen</strong>).</li>
          <li>Confirm, and Stone Dragon lands on your home screen.</li>
        </ol>
        <p class="muted">Then open it from your home screen, just like any other app.</p>
      `,
      actions: [{ label: "Got it", className: "btn btn-primary", onClick: closeModal }],
    });
  }
  function showIOSInstallInstructions() {
    openModal({
      title: "Add to Home Screen",
      body: `
        <p class="muted" style="margin-top:-0.3em">Install Stone Dragon so it opens like an app, and works offline.</p>
        <ol class="install-steps">
          <li>Tap the <strong>Share</strong> button, the square with an arrow pointing up, at the bottom of Safari.</li>
          <li>Scroll down and tap <strong>Add to Home Screen</strong>.</li>
          <li>Tap <strong>Add</strong> in the top-right corner.</li>
        </ol>
        <p class="muted">Then open Stone Dragon from your home screen, just like any other app.</p>
      `,
      actions: [{ label: "Got it", className: "btn btn-primary", onClick: closeModal }],
    });
  }
  // Register these ASAP (module load), since beforeinstallprompt can fire early.
  window.addEventListener("beforeinstallprompt", (e) => {
    e.preventDefault(); // suppress Chrome's mini-infobar; we present our own button
    _deferredInstallPrompt = e;
    refreshInstallUI();
  });
  window.addEventListener("appinstalled", () => {
    _deferredInstallPrompt = null;
    refreshInstallUI();
    toast("Stone Dragon installed 🐉");
  });

  // -------- Init --------
  async function init() {
    // Re-apply the saved color theme immediately (before the session resolves)
    // so a reload keeps the chosen color with no default-blue flash.
    applyTheme(currentThemeForRole(sessionStorage.getItem(KEY_SESSION) === "client" ? "athlete" : "coach"));

    // Auth state change listener — catches PASSWORD_RECOVERY from email reset links
    if (window.Cloud?.enabled) {
      window.Cloud.onAuthStateChange((event) => {
        if (event === "PASSWORD_RECOVERY") {
          showLoginScreen("#login-reset-password");
          $("#reset-pw-new").value = "";
          $("#reset-pw-confirm").value = "";
          $("#reset-pw-error").classList.add("hidden");
          history.replaceState(null, "", window.location.pathname);
        }
      });
    }

    $$("#login-role [data-role], .role-btn[data-role]").forEach((b) => b.addEventListener("click", () => pickRole(b.dataset.role)));
    $$(".back-to-role").forEach((b) => b.addEventListener("click", () => showLoginScreen("#login-role")));
    $("#btn-athlete-signup").addEventListener("click", showAthleteImport);
    $("#btn-copy-app-link")?.addEventListener("click", async () => {
      try { await navigator.clipboard.writeText(APP_URL); toast("App link copied"); }
      catch { toast(APP_URL); }
    });

    // Coach sign-in
    $("#btn-signin").addEventListener("click", signInCoach);
    $("#login-pw").addEventListener("keydown", (e) => { if (e.key === "Enter") signInCoach(); });
    // Coach setup
    $("#btn-setup").addEventListener("click", setupCoachAccount);
    $("#setup-pw-confirm").addEventListener("keydown", (e) => { if (e.key === "Enter") setupCoachAccount(); });
    // Live password-requirement checklists
    attachPwReqs("setup-pw", "setup-pw-reqs");
    attachPwReqs("athlete-setup-pw", "athlete-setup-pw-reqs");
    attachPwReqs("reset-pw-new", "reset-pw-reqs");
    // Add-to-Home-Screen buttons (login screen + athlete portal)
    document.querySelectorAll(".install-app-btn").forEach((b) => b.addEventListener("click", promptInstall));
    refreshInstallUI();
    // Coach panel nav
    $("#btn-coach-to-setup")?.addEventListener("click", () => {
      showLoginScreen("#login-setup");
      const trainer = state.trainerData.trainer;
      if (trainer) {
        show($("#login-migrate-notice"));
        $("#setup-name").value = trainer.name || "";
        $("#setup-email").value = trainer.email || "";
      } else {
        hide($("#login-migrate-notice"));
        $("#setup-name").value = "";
        $("#setup-email").value = "";
      }
      $("#setup-pw").value = "";
      $("#setup-pw-confirm").value = "";
      $("#setup-error").classList.add("hidden");
      setTimeout(() => ($("#setup-email").value ? $("#setup-pw") : $("#setup-name")).focus(), 50);
    });
    $("#btn-setup-to-signin")?.addEventListener("click", showCoachSignin);
    // Coach forgot password / reset
    $("#btn-coach-forgot-pw")?.addEventListener("click", () => showForgotPassword("#login-signin"));
    $("#btn-reset").addEventListener("click", resetTrainerAccount);

    // Invite code (athlete first time)
    $("#btn-import-code").addEventListener("click", importClientCode);
    $("#btn-invite-login").addEventListener("click", loginWithInviteCode);
    $("#btn-client-resume").addEventListener("click", resumeClient);
    $("#invite-code-input").addEventListener("input", (e) => {
      e.target.value = formatInviteInput(e.target.value);
    });
    $("#invite-code-input").addEventListener("keydown", (e) => {
      if (e.key === "Enter") loginWithInviteCode();
    });

    // Athlete setup
    $("#btn-athlete-setup").addEventListener("click", setupAthleteProfile);
    $("#athlete-setup-pw-confirm").addEventListener("keydown", (e) => {
      if (e.key === "Enter") setupAthleteProfile();
    });
    // Athlete sign-in
    $("#btn-athlete-signin").addEventListener("click", signInAthlete);
    $("#athlete-signin-pw").addEventListener("keydown", (e) => {
      if (e.key === "Enter") signInAthlete();
    });
    $("#btn-athlete-use-new-code").addEventListener("click", useNewInviteCode);
    $("#btn-athlete-forget").addEventListener("click", forgetAthleteProfile);
    $("#btn-athlete-forgot-pw")?.addEventListener("click", () => showForgotPassword("#login-athlete-signin"));

    // Forgot / reset password
    $("#btn-send-reset").addEventListener("click", sendPasswordReset);
    $("#forgot-pw-email").addEventListener("keydown", (e) => { if (e.key === "Enter") sendPasswordReset(); });
    $("#btn-back-from-forgot").addEventListener("click", () => showLoginScreen(_forgotFromPanel));
    $("#btn-reset-pw").addEventListener("click", submitPasswordReset);
    $("#reset-pw-confirm").addEventListener("keydown", (e) => { if (e.key === "Enter") submitPasswordReset(); });

    // Sign out on page hide when "Remember me" is unchecked
    window.addEventListener("pagehide", () => {
      if (_signOutOnLeave && window.Cloud?.enabled) window.Cloud.signOut();
    });

    $("#btn-logout").addEventListener("click", () => { Nav.reset(); signOutTrainer(); });
    $("#btn-coach-profile")?.addEventListener("click", openCoachProfile);
    $("#btn-coach-bug-report")?.addEventListener("click", openBugReportModal);
    $("#btn-view-bug-reports")?.addEventListener("click", openBugReportsViewer);
    $("#btn-athlete-bug-report")?.addEventListener("click", openBugReportModal);
    window.addEventListener("online", flushBugQueue);
    flushBugQueue();
    $("#btn-add-client").addEventListener("click", addClientPrompt);
    // Roster grouping tabs (A to Z / Membership / Activity / Program)
    $$("#roster-controls [data-roster-group]").forEach((b) =>
      b.addEventListener("click", () => {
        localStorage.setItem(KEY_ROSTER_GROUP, b.dataset.rosterGroup);
        renderClientGrid();
      }));
    $("#btn-back").addEventListener("click", () => Nav.back(renderDashboard));
    $("#btn-header-back").addEventListener("click", () => Nav.back(renderDashboard));
    // Coach side-nav
    initAnatomyLibrary(); // build the coach + athlete body maps once
    document.querySelectorAll('#coach-nav [data-coach-nav]').forEach((b) => {
      b.addEventListener("click", () => {
        Nav.reset(); // top-level nav is a new root
        const target = b.dataset.coachNav;
        if (target === "library") {
          _programEditorId = null;
          state.currentClientId = null;
          renderDayLibrary();
        } else if (target === "programs") {
          _programEditorId = null;
          state.currentClientId = null;
          renderProgramsList();
        } else if (target === "overview") {
          showCoachOverview();
        } else if (target === "messages") {
          _programEditorId = null;
          state.currentClientId = null;
          switchCoachView("messages");
          hideLibSidebar();
          renderMessagesView();
        } else if (target === "anatomy") {
          _programEditorId = null;
          state.currentClientId = null;
          switchCoachView("anatomy");
          hideLibSidebar();
        } else if (target === "settings") {
          _programEditorId = null;
          state.currentClientId = null;
          switchCoachView("settings");
          hideLibSidebar();
          renderThemePicker($("#coach-theme-picker"), "coach");
        } else {
          _programEditorId = null;
          renderDashboard();
        }
      });
    });

    // Athlete messaging
    $("#msg-send-btn")?.addEventListener("click", sendCoachMessage);
    $("#msg-select-all")?.addEventListener("click", () => {
      (state.trainerData.clients || []).forEach((c) => _msgSelected.add(c.id));
      renderMessagesView();
    });
    $("#msg-clear-all")?.addEventListener("click", () => { _msgSelected.clear(); renderMessagesView(); });
    $("#bulletin-post-btn")?.addEventListener("click", postBulletin);

    // Program creator
    $("#btn-new-program")?.addEventListener("click", newProgram);
    $("#btn-new-program-empty")?.addEventListener("click", newProgram);
    $("#btn-back-to-programs")?.addEventListener("click", () => { _programEditorId = null; renderProgramsList(); });
    $("#btn-editor-add-week-empty")?.addEventListener("click", addWeek);
    // Day Library + Templates (both reachable from the Programs page)
    $("#btn-programs-day-library")?.addEventListener("click", () => { _programEditorId = null; renderDayLibrary(); });
    $("#btn-programs-templates")?.addEventListener("click", () => { _programEditorId = null; renderTemplatesView(); });
    $("#btn-templates-back")?.addEventListener("click", () => { _programEditorId = null; renderProgramsList(); });
    $("#btn-daylib-back")?.addEventListener("click", () => { _programEditorId = null; renderProgramsList(); });
    $("#btn-daylib-new")?.addEventListener("click", () => openDayEditor(null));
    $("#btn-daylib-new-empty")?.addEventListener("click", () => openDayEditor(null));
    $("#btn-daylib-recommended")?.addEventListener("click", openRecommendedTemplatesModal);
    $("#btn-day-editor-back")?.addEventListener("click", () => renderDayLibrary());
    $("#btn-day-editor-save")?.addEventListener("click", saveDayEditor);
    $("#btn-save-program")?.addEventListener("click", async () => {
      const btn = $("#btn-save-program");
      saveTrainer(); // localStorage is written synchronously here
      const orig = btn.textContent;
      btn.disabled = true; btn.textContent = "Saving…";
      try {
        // Push everything pending to the cloud now instead of waiting out the
        // debounce — so work is safe the moment you step away.
        await window.Cloud?.flush?.();
        btn.textContent = "Saved ✓";
      } catch {
        btn.textContent = "Saved locally";
      } finally {
        setTimeout(() => { btn.disabled = false; btn.textContent = orig; }, 1800);
      }
    });
    $("#btn-assign-program")?.addEventListener("click", () => { if (_programEditorId) assignProgramPrompt(_programEditorId); });
    $("#btn-toggle-program-status")?.addEventListener("click", () => {
      const tpl = currentProgramTemplate(); if (!tpl) return;
      setProgramStatus(tpl, tpl.status === "ready" ? "draft" : "ready");
      updateProgramStatusBtn(tpl);
    });
    $("#btn-save-program-to-library")?.addEventListener("click", () => {
      const tpl = currentProgramTemplate(); if (!tpl) return;
      if (!tpl.name?.trim()) { toast("Give the program a name first."); $("#program-editor-name").focus(); return; }
      tpl.savedToLibrary = true;
      saveTrainer();
      toast(`"${tpl.name}" saved to Library ✓`);
    });
    $("#program-editor-name")?.addEventListener("input", (e) => {
      const tpl = currentProgramTemplate(); if (!tpl) return;
      tpl.name = e.target.value;
      saveTrainer();
      updateHeaderBreadcrumb({ name: tpl.name || "Program" });
    });
    $("#program-editor-desc")?.addEventListener("input", (e) => {
      const tpl = currentProgramTemplate(); if (!tpl) return;
      tpl.description = e.target.value;
      saveTrainer();
    });
    $("#btn-browse-recommended-empty")?.addEventListener("click", openRecommendedTemplatesModal);
    $("#btn-delete-client").addEventListener("click", deleteClientPrompt);
    $("#btn-nudge-athlete")?.addEventListener("click", openNudgeModal);
    $("#btn-exit-preview")?.addEventListener("click", () => Nav.back(exitPreview));
    // From preview straight into the editor: the day being viewed, or (from
    // the picker / other tabs) the day the athlete is on per synced progress.
    $("#btn-preview-edit-day")?.addEventListener("click", () => {
      if (!state.previewMode) return;
      const view = state.workoutView || {};
      const viewed = view.mode === "detail" && view.dayId
        ? { weekId: view.weekId, dayId: view.dayId }
        : null;
      exitPreview();
      // The preview's nav entries are stale now — Back should return to the
      // athlete list, same as opening the editor from a card.
      Nav.reset();
      Nav.push(renderDashboard);
      const c = currentClient();
      if (!c) return;
      const pos = viewed || athleteCurrentDay(c);
      if (pos) editClientDay(c.id, pos.weekId, pos.dayId);
    });
    $("#btn-load-program").addEventListener("click", openLoadProgramModal);
    $("#btn-load-program-empty").addEventListener("click", openLoadProgramModal);
    $("#btn-archive-program").addEventListener("click", archiveCurrentProgram);
    $("#btn-save-program-to-library")?.addEventListener("click", saveClientProgramToLibrary);
    $("#btn-new-tpl-folder")?.addEventListener("click", openNewTemplateFolder);
    $("#btn-export-data")?.addEventListener("click", exportAllData);
    $("#btn-import-data")?.addEventListener("click", () => $("#import-data-input")?.click());
    $("#import-data-input")?.addEventListener("change", (e) => {
      const file = e.target.files?.[0];
      if (file) importAllData(file);
      e.target.value = ""; // let the same file be picked again
    });

    // Exercise library
    $("#btn-close-library").addEventListener("click", closeExLibrary);
    $("#ex-library-backdrop").addEventListener("click", closeExLibrary);
    $("#ex-library-search").addEventListener("input", (e) => renderExLibrary(e.target.value));
    $("#ex-lib-sb-search")?.addEventListener("input", (e) => renderSidebarLibrary(e.target.value));
    // × buttons wipe the search and put the cursor back in the field.
    const wireLibClear = (inputSel, clearSel, rerender) => {
      const inp = $(inputSel), btn = $(clearSel);
      if (!inp || !btn) return;
      const refresh = () => btn.classList.toggle("hidden", !inp.value);
      inp.addEventListener("input", refresh);
      btn.addEventListener("click", () => { inp.value = ""; refresh(); rerender(); inp.focus(); });
    };
    wireLibClear("#ex-library-search", "#ex-library-clear", () => renderExLibrary(""));
    wireLibClear("#ex-lib-sb-search", "#ex-lib-sb-clear", () => renderSidebarLibrary(""));
    $$(".ex-lib-sb-tab").forEach((t) => t.addEventListener("click", () => setLibSbTab(t.dataset.libTab)));
    setupExAddForm("ex-lib-sb-add");
    setupExAddForm("ex-lib-md-add");

    $("#btn-add-package")?.addEventListener("click", openAddPackageModal);
    $("#btn-gift-session")?.addEventListener("click", openGiftSessionModal);
    $("#btn-post-open-slot")?.addEventListener("click", openPostSlotModal);
    $("#btn-redeem-session")?.addEventListener("click", openRedeemSessionModal);
    prefillRememberedEmails();
    $("#btn-export-sessions")?.addEventListener("click", () => {
      const c = currentClient(); if (c) exportSessionHistory(c);
    });
    $("#btn-athlete-export-sessions")?.addEventListener("click", () => {
      const client = state.clientData.program?.client; if (client) exportSessionHistory(client);
    });
    $("#btn-regen-invite").addEventListener("click", regenerateInviteCode);
    $("#btn-copy-invite").addEventListener("click", copyInviteCode);
    $("#btn-email-invite")?.addEventListener("click", emailInviteLink);
    $("#btn-show-invite")?.addEventListener("click", () => {
      setInviteCodeVisible($("#invite-code-display").classList.contains("hidden"));
    });

    // Calendar (coach)
    $("#cal-prev").addEventListener("click", () => { stepCoachMonth(-1); });
    $("#cal-next").addEventListener("click", () => { stepCoachMonth(1); });
    $("#cal-today").addEventListener("click", () => {
      const now = new Date();
      state.coachCal = { year: now.getFullYear(), month: now.getMonth() };
      renderCoachCalendar();
    });
    // Calendar (athlete)
    $("#ccal-prev").addEventListener("click", () => { stepAthleteMonth(-1); });
    $("#ccal-next").addEventListener("click", () => { stepAthleteMonth(1); });
    $("#ccal-today").addEventListener("click", () => {
      const now = new Date();
      state.athleteCal = { year: now.getFullYear(), month: now.getMonth() };
      renderAthleteCalendar();
    });
    // Dashboard overview calendar
    $("#dash-cal-prev").addEventListener("click", () => {
      if (!state.dashCal) { const n = new Date(); state.dashCal = { year: n.getFullYear(), month: n.getMonth() }; }
      let { year, month } = state.dashCal;
      month--; if (month < 0) { month = 11; year--; }
      state.dashCal = { year, month }; renderDashboardCalendar();
    });
    $("#dash-cal-next").addEventListener("click", () => {
      if (!state.dashCal) { const n = new Date(); state.dashCal = { year: n.getFullYear(), month: n.getMonth() }; }
      let { year, month } = state.dashCal;
      month++; if (month > 11) { month = 0; year++; }
      state.dashCal = { year, month }; renderDashboardCalendar();
    });
    $("#dash-cal-today").addEventListener("click", () => {
      const n = new Date(); state.dashCal = { year: n.getFullYear(), month: n.getMonth() };
      renderDashboardCalendar();
    });
    $("#dash-cal-refresh")?.addEventListener("click", refreshDashCalSetmore);

    $$(".tab[data-tab]").forEach((t) => t.addEventListener("click", () => setTab(t.dataset.tab)));
    $$(".tab[data-ctab]").forEach((t) => t.addEventListener("click", () => {
      if (!state.previewMode) Nav.reset(); // switching top-level tabs is a new root (except mid-preview)
      setClientTab(t.dataset.ctab);
    }));

    // Rest timer (athlete workout detail): the small button picks the length,
    // ▶ Go starts/stops the repeating countdown.
    $("#rest-timer-btn")?.addEventListener("click", () => {
      if (_restIv) { stopRestTimer(false); return; } // running → tap stops
      startRestTimer(restDur());
    });
    $("#rest-timer-opt-btn")?.addEventListener("click", () =>
      $("#rest-timer-pop")?.classList.toggle("hidden"));
    $$("#rest-timer-pop [data-rest]").forEach((b) =>
      b.addEventListener("click", () => {
        const sec = Number(b.dataset.rest);
        localStorage.setItem(KEY_REST_DUR, String(sec));
        refreshRestOptBtn();
        startRestTimer(sec); // picking a length also starts it, one-tap flow
      }));
    // 🔔/🔕 — end-of-rest ding on/off, remembered per device.
    const restSoundBtn = $("#rest-sound-btn");
    const refreshRestSoundBtn = () => {
      if (!restSoundBtn) return;
      restSoundBtn.textContent = restSoundOn() ? "🔔" : "🔕";
      restSoundBtn.classList.toggle("off", !restSoundOn());
      restSoundBtn.title = restSoundOn() ? "Timer ding: on" : "Timer ding: off";
    };
    refreshRestSoundBtn();
    restSoundBtn?.addEventListener("click", () => {
      localStorage.setItem(KEY_REST_SOUND, restSoundOn() ? "0" : "1");
      refreshRestSoundBtn();
      if (restSoundOn()) restBeep(); // audible confirm doubles as the audio unlock
    });

    // Guided tour replays (? buttons in both headers)
    $("#btn-tour-coach")?.addEventListener("click", () => startTour(coachTourSteps(), KEY_TOUR_COACH));
    $("#btn-tour-client")?.addEventListener("click", () => beginAthleteTour());

    $("#btn-client-logout").addEventListener("click", () => { Nav.reset(); exitClient(); });
    $("#btn-client-profile")?.addEventListener("click", () => setClientTab("profile"));
    $("#btn-back-to-picker")?.addEventListener("click", () => Nav.back(backToWorkoutPicker));
    $("#btn-log-bw").addEventListener("click", logBodyweight);
    $("#btn-import-scale")?.addEventListener("click", () => $("#scale-csv-input")?.click());
    $("#scale-csv-input")?.addEventListener("change", (e) => {
      const f = e.target.files && e.target.files[0];
      if (f) importScaleCsv(f);
      e.target.value = ""; // allow re-selecting the same file
    });
    $("#btn-add-cardio")?.addEventListener("click", () => openCardioModal());
    ["#ath-prof-name", "#ath-prof-age", "#ath-prof-height-ft", "#ath-prof-height-in", "#ath-prof-weight", "#ath-prof-goals"]
      .forEach((sel) => $(sel)?.addEventListener("change", saveAthleteProfile));
    $("#client-feedback").addEventListener("input", () => {
      state.clientData.progress.feedback = $("#client-feedback").value;
      saveClient();
    });

    document.querySelectorAll("#modal [data-close]").forEach((el) =>
      el.addEventListener("click", closeModal)
    );

    bindProfileInputs();

    // Safety net: when the tab is hidden or closed, immediately flush any pending
    // debounced cloud pushes so stepping away can't lose recent edits.
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") { WorkoutClock.onHidden(); window.Cloud?.flush?.(); }
      else WorkoutClock.onVisible();
    });
    window.addEventListener("pagehide", () => { WorkoutClock.leave(); window.Cloud?.flush?.(); });

    // Register in-workout interactions so the active clock doesn't idle out mid-set.
    $("#workout-detail-list")?.addEventListener("click", () => WorkoutClock.touch());

    // Keep --header-h equal to each screen's real header height so the sticky
    // coach nav / athlete tabs pin exactly where they rest (no slide-under on
    // scroll when header padding or content changes the height). Re-measured
    // on resize and after full load (the header logo image can shift height).
    window.addEventListener("resize", syncHeaderHeights);
    window.addEventListener("load", syncHeaderHeights);
    syncHeaderHeights();

    // Invite deep link: ?invite=XXXX-XXXX (from the coach's emailed invite)
    // jumps straight to the athlete invite screen with the code pre-filled
    // and submitted. Takes priority over session restore — the recipient is
    // (re)claiming this program on purpose. Param is stripped so a reload
    // doesn't re-run the flow.
    const inviteParam = new URLSearchParams(window.location.search).get("invite");
    if (inviteParam && normalizeInviteCode(inviteParam).length === 8) {
      const code = normalizeInviteCode(inviteParam);
      history.replaceState(null, "", window.location.pathname);
      showAthleteImport();
      $("#invite-code-input").value = formatInviteInput(code);
      loginWithInviteCode();
      return;
    }

    // Boot: check for password-recovery URL hash, then Supabase session, then show login
    if (window.Cloud?.enabled) {
      try {
        const session = await window.Cloud.getSession();
        if (session) {
          const userId = session.user.id;
          // Fast path: valid local data + session → auto-login, but still
          // refresh templates/athletes from the cloud first so anything
          // created on another device shows up here too; degrade to the
          // cached data silently if offline.
          if (state.trainerData.trainer && state.trainerData.coachAuthId === userId) {
            // If local template edits haven't been confirmed pushed, don't let the
            // cloud refresh overwrite them — keep local and re-push instead.
            const templatesDirty = localStorage.getItem(KEY_TEMPLATES_DIRTY) === "1";
            const libPrefsDirty = localStorage.getItem(KEY_LIBPREFS_DIRTY) === "1";
            try {
              const fresh = await window.Cloud.getCoachByAuthUserId(userId);
              if (fresh) populateCoachFromCloud(fresh.coach, fresh.athletes, { keepLocalTemplates: templatesDirty, keepLocalLibPrefs: libPrefsDirty });
            } catch (e) { console.warn("[Boot] Coach refresh failed, using cached data", e); }
            if (templatesDirty || libPrefsDirty) saveTrainer(); // reconcile unsynced local work up to the cloud
            // Retry athlete writes that never reached the cloud, so they stop
            // being at risk of the next refresh reverting them.
            Object.keys(dirtyAthletes()).forEach((id) => {
              const c = state.trainerData.clients.find((x) => x.id === id);
              if (c) pushAthlete(c);
            });
            signIntoTrainer(); return;
          }
          if (state.clientData.program && state.clientData.profile?.email === session.user.email) {
            // Refresh the coach-assigned program from the cloud so newly
            // assigned workouts show up on reopen; degrade to the cached
            // program silently if offline.
            try {
              const fresh = await window.Cloud.getAthleteByAuthUserId(userId);
              if (fresh?.athlete) {
                state.clientData.program = buildProgramFromAthlete(fresh.athlete);
                if (fresh.progress) state.clientData.progress = fresh.progress;
                ensureProgressShape(state.clientData.progress);
                saveClient();
              }
            } catch (e) { console.warn("[Boot] Athlete refresh failed, using cached program", e); }
            enterClientPortal(); return;
          }
          // Slow path: unknown device, fetch role from cloud
          const coachData = await window.Cloud.getCoachByAuthUserId(userId);
          if (coachData) {
            populateCoachFromCloud(coachData.coach, coachData.athletes);
            signIntoTrainer(); return;
          }
          const athleteResult = await window.Cloud.getAthleteByAuthUserId(userId);
          if (athleteResult?.athlete) {
            const { athlete, progress } = athleteResult;
            state.clientData.program = buildProgramFromAthlete(athlete);
            state.clientData.progress = progress || emptyProgress();
            ensureProgressShape(state.clientData.progress);
            state.clientData.profile = { name: athlete.name, email: session.user.email, createdAt: Date.now() };
            saveClient();
            enterClientPortal(); return;
          }
        }
      } catch (e) {
        console.warn("[Boot] Session check failed", e);
      }
    } else {
      // Offline fallback: restore from sessionStorage
      const sess = sessionStorage.getItem(KEY_SESSION);
      if (sess === "trainer" && state.trainerData.trainer) { signIntoTrainer(); return; }
      if (sess === "client" && state.clientData.program) { enterClientPortal(); return; }
    }
    showLoginScreen("#login-role");
  }

  function stepCoachMonth(delta) {
    let { year, month } = state.coachCal;
    month += delta;
    if (month < 0) { month = 11; year--; }
    if (month > 11) { month = 0; year++; }
    state.coachCal = { year, month };
    renderCoachCalendar();
  }
  function stepAthleteMonth(delta) {
    let { year, month } = state.athleteCal;
    month += delta;
    if (month < 0) { month = 11; year--; }
    if (month > 11) { month = 0; year++; }
    state.athleteCal = { year, month };
    renderAthleteCalendar();
  }

  document.addEventListener("DOMContentLoaded", init);
})();
