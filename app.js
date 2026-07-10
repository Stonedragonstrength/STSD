/* ============ Stone Dragon Strength Training — app.js ============ */
(function () {
  "use strict";

  // -------- Storage --------
  const KEY_TRAINER = "trainerpro_data_v1";
  const KEY_CLIENT  = "trainerpro_client_v1";
  const KEY_SESSION = "trainerpro_session_v1";

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
  function saveTrainer() {
    localStorage.setItem(KEY_TRAINER, JSON.stringify(state.trainerData));
    // Cloud: debounced push of the client we're currently editing.
    if (window.Cloud?.enabled && state.currentClientId) {
      const c = state.trainerData.clients.find((x) => x.id === state.currentClientId);
      if (c) window.Cloud.debounce(`athlete:${c.id}`, () =>
        window.Cloud.upsertAthlete(c, state.trainerData.coachId)
      );
    }
    // Cloud: debounced push of the coach's program/workout template library,
    // so templates created on one device show up on every other device.
    if (window.Cloud?.enabled && state.trainerData.coachId) {
      window.Cloud.debounce(`coach-templates:${state.trainerData.coachId}`, () =>
        window.Cloud.updateCoachTemplates(
          state.trainerData.coachId,
          state.trainerData.programTemplates,
          state.trainerData.workoutTemplates
        )
      );
    }
  }
  function saveClient() {
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
  function parseISO(s) { return new Date(s + "T00:00:00"); }

  function encodeData(obj) {
    const json = JSON.stringify(obj);
    return btoa(unescape(encodeURIComponent(json)));
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
  let _exLibraryTarget = null; // { day, rerenderFn } — set by openExLibrary(), used for tap-to-add
  let _prNewLifts = [];
  let _prDragSrcId = null;
  function currentProgramTemplate() {
    return (state.trainerData.programTemplates || []).find((p) => p.id === _programEditorId) || null;
  }

  // -------- Data factories --------
  const DEFAULT_PR_LIFTS = ["Barbell Squat", "Deadlift", "Bench Press", "Overhead BB Press", "Strict Curl"];
  function makeClient(name) {
    return {
      id: uid(), name: name || "New Athlete",
      age: "", heightIn: "", weightLb: "",
      goals: "", notes: "",
      weeks: [],
      schedule: {},
      coachPRs: DEFAULT_PR_LIFTS.map((n) => ({ id: uid(), name: n, pr1: "", pr2: "", pr3: "" })),
      sessionBank: { packages: [], redemptions: [] },
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
  function makePR(seed) {
    return {
      id: uid(),
      name: (seed?.name || "").trim(),
      weight: seed?.weight || "",
      reps: seed?.reps || "",
      date: seed?.date || todayISO(),
      notes: seed?.notes || "",
    };
  }
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
  function ensureDietShape(week) {
    if (!week.diet || typeof week.diet !== "object") week.diet = {};
    if (typeof week.diet.notes !== "string") week.diet.notes = "";
    // Migration: collapse legacy per-day grid into single weekly target (use first non-empty day).
    if (week.diet.calories == null && Array.isArray(week.diet.days)) {
      const firstCal = week.diet.days.find((d) => d.calories !== "" && d.calories != null);
      week.diet.calories = firstCal ? firstCal.calories : "";
    }
    if (week.diet.protein == null && Array.isArray(week.diet.days)) {
      const firstP = week.diet.days.find((d) => d.protein !== "" && d.protein != null);
      week.diet.protein = firstP ? firstP.protein : "";
    }
    if (week.diet.calories == null) week.diet.calories = "";
    if (week.diet.protein == null) week.diet.protein = "";
    // Drop legacy days array now that single-target is the source of truth.
    delete week.diet.days;
  }
  function makeDay(n, name) {
    return { id: uid(), name: name || `Day ${n}`, exercises: [] };
  }
  function makeExercise(seed) {
    return {
      id: uid(),
      name: seed?.name || "",
      sets: seed?.sets || "3",
      currentWeight: "",
      currentReps: seed?.reps || "",
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
    { group: "Equipment",   tags: ["BB", "DB", "KB", "EZ Bar", "Cable", "Rope", "Band", "Machine"], multi: true },
    { group: "Position",    tags: ["Incline", "Decline", "Elevated", "Seated", "Standing", "Kneeling", "Raised"] },
    { group: "Style",       tags: ["Pause", "Tempo", "Explosive", "Isometric"] },
    { group: "Hold",        tags: ["1S", "2S", "3S", "4S", "5S"] },
  ];
  // Hold (seconds) tags only apply alongside the Isometric tag.
  const HOLD_TAGS = ["1S", "2S", "3S", "4S", "5S"];

  const TAG_COLORS = {
    "1A":        { color: "#f87171", bg: "rgba(248,113,113,0.18)" },
    "1L":        { color: "#fb923c", bg: "rgba(251,146,60,0.18)"  },
    "Alternating":     { color: "#ec4899", bg: "rgba(236,72,153,0.18)"  },
    "Non-Alternating": { color: "#64748b", bg: "rgba(100,116,139,0.18)" },
    "BB":        { color: "#818cf8", bg: "rgba(129,140,248,0.18)" },
    "DB":        { color: "#60a5fa", bg: "rgba(96,165,250,0.18)"  },
    "KB":        { color: "#a78bfa", bg: "rgba(167,139,250,0.18)" },
    "EZ Bar":    { color: "#c084fc", bg: "rgba(192,132,252,0.18)" },
    "Cable":     { color: "#2dd4bf", bg: "rgba(45,212,191,0.18)"  },
    "Rope":      { color: "#38bdf8", bg: "rgba(56,189,248,0.18)"  },
    "Band":      { color: "#4ade80", bg: "rgba(74,222,128,0.18)"  },
    "Machine":   { color: "#facc15", bg: "rgba(250,204,21,0.18)"  },
    "Incline":   { color: "#fbbf24", bg: "rgba(251,191,36,0.18)"  },
    "Decline":   { color: "#f97316", bg: "rgba(249,115,22,0.18)"  },
    "Elevated":  { color: "#22d3ee", bg: "rgba(34,211,238,0.18)"  },
    "Seated":    { color: "#a3e635", bg: "rgba(163,230,53,0.18)"  },
    "Standing":  { color: "#e879f9", bg: "rgba(232,121,249,0.18)" },
    "Kneeling":  { color: "#f43f5e", bg: "rgba(244,63,94,0.18)"   },
    "Raised":    { color: "#f472b6", bg: "rgba(244,114,182,0.18)" },
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
    const base = parseFloat(prescribedWeight);
    if (!isFinite(base)) return null; // BW or unset — no computed number
    return Math.round((base * (parseInt(pct, 10) / 100)));
  }
  function finisherSummary(ex) {
    const parts = [];
    if (ex.burnout?.pct) parts.push(`🔥${ex.burnout.pct}%`);
    if (ex.dropset?.pcts?.length) parts.push(`⬇${ex.dropset.pcts.join("→")}%`);
    return parts.join("  ");
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

  function renderModChips(container, ex, position) {
    // position: "before" = Unilateral+Equipment+Position  "after" = Style+Hold
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
      chip.title = `${g.group} — click to remove`;
      chip.addEventListener("click", () => {
        ex.modifiers = (ex.modifiers || []).filter((m) => m !== tag);
        saveTrainer();
        renderModChips(container, ex, position);
      });
      container.appendChild(chip);
    });
  }

  function openModPicker(ex, anchorBtn, chipsBefore, chipsAfter) {
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
      lbl.textContent = group === "Hold" ? "Hold (seconds) — Isometric only" : group;
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
          renderModChips(chipsBefore, ex, "before");
          renderModChips(chipsAfter, ex, "after");
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
  if (!Array.isArray(state.trainerData.programTemplates)) {
    state.trainerData.programTemplates = [];
  }
  state.trainerData.clients.forEach((c) => {
    if (!c.schedule) c.schedule = {};
    if (!c.coachPRs) c.coachPRs = [];
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
  function show(el) { el.classList.remove("hidden"); }
  function hide(el) { el.classList.add("hidden"); }

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
      toast(`Profile saved — welcome, ${name.split(/\s+/)[0]}!`);
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
    if (!c.common) return { ok: false, message: "That password is too common — choose something harder to guess." };
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
          showErr(err, "An account with this email already exists — sign in instead.");
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
      toast(isMigration ? "Account upgraded — welcome!" : `Welcome, ${name.split(/\s+/)[0]}!`);
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

  function populateCoachFromCloud(coach, athletes) {
    state.trainerData.trainer = { name: coach.display_name || "", email: coach.email || "" };
    state.trainerData.coachId = coach.id;
    state.trainerData.coachAuthId = coach.auth_user_id;
    state.trainerData.programTemplates = coach.program_templates || [];
    state.trainerData.workoutTemplates = coach.workout_templates || [];
    state.trainerData.clients = (athletes || []).map((a) => {
      if (!a.schedule) a.schedule = {};
      if (!a.coachPRs) a.coachPRs = [];
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

  function signIntoTrainer() {
    state.mode = "trainer";
    sessionStorage.setItem(KEY_SESSION, "trainer");
    hide($("#screen-login"));
    show($("#screen-app"));
    hide($("#screen-client"));
    $("#header-trainer-name").textContent = state.trainerData.trainer.name;
    renderDashboard();
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
      packages:        "#view-packages",
      programs:        "#view-programs",
      "program-editor": "#view-program-editor",
      "day-library":   "#view-day-library",
      client:          "#view-client",
    };
    Object.values(map).forEach((sel) => { const el = $(sel); if (el) hide(el); });
    show($(map[name] || map.athletes));
    const navKey = { client: "athletes", "program-editor": "programs", "day-library": "programs" }[name] || name;
    document.querySelectorAll('#coach-nav [data-coach-nav]').forEach((b) => {
      b.classList.toggle("active", b.dataset.coachNav === navKey);
    });
    if (name === "program-editor") { showLibSidebar(); } else if (name !== "client") { hideLibSidebar(); }
  }

  const AVATAR_COLORS = ["#06b6d4","#10b981","#8b5cf6","#f59e0b","#ef4444","#ec4899","#3b82f6","#f97316"];
  function avatarColor(name) {
    const code = (name || "?").toUpperCase().charCodeAt(0);
    return AVATAR_COLORS[code % AVATAR_COLORS.length];
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

  let _packagesBadgeBootstrapped = false;
  function renderDashboard() {
    state.currentClientId = null;
    switchCoachView("athletes");
    updateHeaderBreadcrumb(null);
    updatePackagesNavBadge();
    // One background pull per session so the badge is fresh at login without
    // waiting for the coach to open each athlete.
    if (!_packagesBadgeBootstrapped && window.Cloud?.enabled) {
      _packagesBadgeBootstrapped = true;
      refreshAllAthletePackages();
    }

    const grid = $("#client-grid");
    const empty = $("#client-empty");
    grid.innerHTML = "";

    // Stats strip
    let strip = $("#dash-stats-strip");
    if (!strip) {
      strip = document.createElement("div");
      strip.id = "dash-stats-strip";
      strip.className = "dash-stats-strip";
      grid.parentElement.insertBefore(strip, grid);
    }
    const totalWeeks = state.trainerData.clients.reduce((n, c) => n + c.weeks.length, 0);
    const totalEx = state.trainerData.clients.reduce((n, c) =>
      n + c.weeks.reduce((m, w) => m + w.days.reduce((k, d) => k + d.exercises.length, 0), 0), 0);
    strip.innerHTML = `
      <div class="dash-stat-item"><div class="num">${state.trainerData.clients.length}</div><div class="lbl">Athletes</div></div>
      <div class="dash-stat-item"><div class="num">${totalWeeks}</div><div class="lbl">Program Weeks</div></div>
      <div class="dash-stat-item"><div class="num">${totalEx}</div><div class="lbl">Exercises</div></div>`;

    if (state.trainerData.clients.length === 0) { show(empty); return; }
    hide(empty);

    const sorted = [...state.trainerData.clients].sort((a, b) => a.name.localeCompare(b.name));
    for (const c of sorted) {
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

      const card = document.createElement("div");
      card.className = "client-card";

      // Top: avatar + name + meta
      const top = document.createElement("div");
      top.className = "client-card-top";
      const avatar = document.createElement("div");
      avatar.className = "client-avatar";
      avatar.style.background = avatarColor(c.name);
      avatar.textContent = nameInitials(c.name);
      const info = document.createElement("div");
      info.className = "client-card-info";
      const nameEl = document.createElement("h3");
      nameEl.textContent = c.name;
      const metaEl = document.createElement("div");
      metaEl.className = "meta";
      const metaParts = [];
      if (c.age) metaParts.push(c.age + " yrs");
      if (c.weightLb) metaParts.push(c.weightLb + " lb");
      metaEl.textContent = metaParts.join(" · ") || "Profile incomplete";
      info.appendChild(nameEl);
      info.appendChild(metaEl);
      top.appendChild(avatar);
      top.appendChild(info);

      // Mobile-only compact line: current week/day they've completed up to.
      // (Desktop keeps the fuller stats + progress-bar layout below.)
      const mobileProgress = document.createElement("div");
      mobileProgress.className = "client-card-mobile-progress";
      mobileProgress.textContent = currentProgressLabel(c, totalDays, hasSyncedData, isComplete);
      info.appendChild(mobileProgress);

      // Stats row
      const statsRow = document.createElement("div");
      statsRow.className = "stats";
      statsRow.innerHTML = `
        <div class="stat"><strong>${weekCount}</strong>${weekCount === 1 ? "wk" : "wks"}</div>
        <div class="stat"><strong>${exerciseCount}</strong>${exerciseCount === 1 ? "exercise" : "exercises"}</div>`;

      // Progress
      const prog = document.createElement("div");
      if (totalDays === 0) {
        prog.className = "week-progress-mini no-data";
        prog.textContent = "No program yet";
      } else if (!hasSyncedData) {
        prog.className = "week-progress-mini no-data";
        prog.textContent = "Awaiting first sync";
      } else {
        prog.className = `week-progress-mini${isComplete ? " complete" : ""}`;
        prog.innerHTML = `
          <div class="progress-label">
            <span>${completedDays} / ${totalDays} days</span>
            <span class="pct">${pct}%</span>
          </div>
          <div class="progress-track"><div class="progress-fill" style="width:${pct}%"></div></div>`;
      }

      // Quick actions
      const actions = document.createElement("div");
      actions.className = "card-quick-actions";

      const openBtn = document.createElement("button");
      openBtn.className = "btn btn-primary btn-sm";
      openBtn.textContent = "Program";
      openBtn.addEventListener("click", (e) => { e.stopPropagation(); openClient(c.id); setTab("program"); });

      const shareBtn = document.createElement("button");
      shareBtn.className = "btn btn-ghost btn-sm";
      shareBtn.textContent = "Share";
      shareBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        openClient(c.id);
        shareClient();
      });

      const inviteBtn = document.createElement("button");
      inviteBtn.className = "btn btn-ghost btn-sm";
      inviteBtn.textContent = "🔑 Code";
      inviteBtn.title = c.inviteCode || "";
      inviteBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        if (c.inviteCode) {
          navigator.clipboard?.writeText(c.inviteCode)
            .then(() => toast(`Invite code copied: ${c.inviteCode}`))
            .catch(() => toast(`Invite code: ${c.inviteCode}`, 4000));
        } else {
          toast("No invite code — open athlete to generate one.");
        }
      });

      actions.appendChild(openBtn);
      actions.appendChild(shareBtn);
      actions.appendChild(inviteBtn);

      card.appendChild(top);
      card.appendChild(statsRow);
      card.appendChild(prog);
      card.appendChild(actions);
      card.addEventListener("click", () => { openClient(c.id); setTab("profile"); });
      grid.appendChild(card);
    }
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
    const exCount = tpl.weeks.reduce((n, w) => n + w.days.reduce((m, d) => m + d.exercises.length, 0), 0);
    const ready = tpl.status === "ready";
    const card = document.createElement("div");
    card.className = "program-tpl-card" + (ready ? " is-ready" : "");

    const nameEl = document.createElement("h3");
    nameEl.textContent = tpl.name || "Untitled Program";
    const desc = document.createElement("p");
    desc.className = "desc";
    desc.textContent = tpl.description || "";
    const meta = document.createElement("div");
    meta.className = "meta";
    meta.textContent = `${weekCount} week${weekCount !== 1 ? "s" : ""} · ${exCount} exercise${exCount !== 1 ? "s" : ""}`;

    const info = document.createElement("div");
    info.className = "program-tpl-info";
    info.appendChild(nameEl);
    if (tpl.description) info.appendChild(desc);
    info.appendChild(meta);

    const actions = document.createElement("div");
    actions.className = "program-tpl-actions";

    const deleteBtn = document.createElement("button");
    deleteBtn.className = "btn-delete-mini";
    deleteBtn.title = "Delete program";
    deleteBtn.textContent = "×";
    deleteBtn.addEventListener("click", () => {
      if (!window.confirm(`Delete "${tpl.name || "this program"}"?`)) return;
      state.trainerData.programTemplates = state.trainerData.programTemplates.filter((p) => p.id !== tpl.id);
      saveTrainer(); renderProgramsList();
    });

    if (ready) {
      // Ready to assign: lead with the assign action; keep edit + reopen handy.
      const assignBtn = document.createElement("button");
      assignBtn.className = "btn btn-primary btn-sm";
      assignBtn.textContent = "Assign to athlete →";
      assignBtn.addEventListener("click", () => assignProgramPrompt(tpl.id));
      const editBtn = document.createElement("button");
      editBtn.className = "btn btn-ghost btn-sm";
      editBtn.textContent = "Edit";
      editBtn.addEventListener("click", () => openProgramEditor(tpl.id));
      const reopenBtn = document.createElement("button");
      reopenBtn.className = "btn btn-ghost btn-sm";
      reopenBtn.textContent = "Reopen";
      reopenBtn.title = "Move back to in progress";
      reopenBtn.addEventListener("click", () => { setProgramStatus(tpl, "draft"); renderProgramsList(); });
      actions.appendChild(assignBtn);
      actions.appendChild(editBtn);
      actions.appendChild(reopenBtn);
    } else {
      // In progress: lead with edit; let it be marked complete.
      const editBtn = document.createElement("button");
      editBtn.className = "btn btn-primary btn-sm";
      editBtn.textContent = "Edit";
      editBtn.addEventListener("click", () => openProgramEditor(tpl.id));
      const completeBtn = document.createElement("button");
      completeBtn.className = "btn btn-ghost btn-sm";
      completeBtn.textContent = "Mark complete ✓";
      completeBtn.addEventListener("click", () => { setProgramStatus(tpl, "ready"); renderProgramsList(); });
      actions.appendChild(editBtn);
      actions.appendChild(completeBtn);
    }
    actions.appendChild(deleteBtn);

    card.appendChild(info);
    card.appendChild(actions);
    return card;
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
        inner.className = "program-template-grid-inner";
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

    grid.appendChild(section("🟡 In progress", "Nothing in progress — new programs land here.", inProgress));
    grid.appendChild(section("🟢 Ready to assign", "No finished programs yet. Mark one complete when it's ready.", ready));
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
    renderWeeks();
  }

  function updateProgramStatusBtn(tpl) {
    const btn = $("#btn-toggle-program-status");
    if (!btn) return;
    const ready = tpl.status === "ready";
    btn.textContent = ready ? "✓ Ready · reopen" : "Mark complete ✓";
    btn.classList.toggle("is-ready", ready);
    btn.title = ready ? "This program is ready to assign — click to move back to in progress" : "Mark this program complete and ready to assign";
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

  function assignProgramPrompt(tplId) {
    const tpl = (state.trainerData.programTemplates || []).find((p) => p.id === tplId);
    if (!tpl) return;
    const clients = state.trainerData.clients;
    if (!clients.length) { toast("No athletes yet — add one first."); return; }

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
                label: "Archived — " + d.toLocaleDateString("en-US", { month: "long", year: "numeric" }),
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
            // Target this athlete for the cloud push. saveTrainer() only syncs
            // state.currentClientId, which may be a different athlete (or none)
            // when assigning from the Programs tab — so point it here first and
            // push this athlete directly so their program actually reaches the
            // cloud (and their device).
            state.currentClientId = client.id;
            saveTrainer();
            if (window.Cloud?.enabled) window.Cloud.upsertAthlete(client, state.trainerData.coachId);
            closeModal();
            toast(archiveFirst
              ? `Archived old program & assigned "${tpl.name || "Program"}" to ${client.name} ✓`
              : `"${tpl.name || "Program"}" assigned to ${client.name} ✓`);
            openClient(client.id);
            setTab("program");
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
              label: "Archived — " + d.toLocaleDateString("en-US", { month: "long", year: "numeric" }),
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
          saveTrainer();
          if (window.Cloud?.enabled) window.Cloud.upsertAthlete(c, state.trainerData.coachId);
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
    renderCoachSessions();
    const now = new Date();
    state.coachCal = { year: now.getFullYear(), month: now.getMonth() };
    renderCoachCalendar();
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
    setProfileLocked(true);
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
    saveTrainer();
    $("#client-name-display").textContent = c.name || "(unnamed)";
    $("#client-meta-display").textContent = clientMetaText(c);
    flashSaved($("#prof-saved"));
    setProfileLocked(true);
  }
  function regenerateInviteCode() {
    const c = currentClient(); if (!c) return;
    if (!window.confirm("Regenerate this athlete's invite code? Any old code you've sent them will stop working.")) return;
    c.inviteCode = makeInviteCode();
    saveTrainer();
    $("#invite-code-display").textContent = c.inviteCode;
    toast("New code generated");
  }
  async function copyInviteCode() {
    const c = currentClient(); if (!c) return;
    try { await navigator.clipboard.writeText(c.inviteCode); toast("Code copied"); }
    catch { toast("Couldn't copy — code: " + c.inviteCode, 4000); }
  }
  function bindProfileInputs() {
    $("#btn-profile-edit").addEventListener("click", () => {
      setProfileLocked(false);
      $("#prof-name").focus();
    });
    $("#btn-profile-save").addEventListener("click", saveProfileFields);
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
    { name: "Posterior Chain", cats: ["Hamstrings","Glutes","Back"] },
    { name: "Glute & Ham",     cats: ["Glutes","Hamstrings","Adductors"] },
    { name: "Conditioning",    cats: ["Cardio","Carries","Core"], noCore: true },
    { name: "Core & Carry",    cats: ["Core","Carries"], noCore: true },
  ];
  const GEN_STYLES = [
    { name: "Strength",    primary: { sets: "5", reps: "5"  }, acc: { sets: "4", reps: "8"  }, core: { sets: "3", reps: "12" }, tag: "Pause" },
    { name: "Power",       primary: { sets: "5", reps: "3"  }, acc: { sets: "4", reps: "6"  }, core: { sets: "3", reps: "12" }, tag: "Explosive" },
    { name: "Hypertrophy", primary: { sets: "4", reps: "10" }, acc: { sets: "3", reps: "12" }, core: { sets: "3", reps: "15" }, tag: "Tempo" },
    { name: "Pump",        primary: { sets: "4", reps: "12" }, acc: { sets: "3", reps: "15" }, core: { sets: "3", reps: "20" }, tag: null },
    { name: "Endurance",   primary: { sets: "3", reps: "15" }, acc: { sets: "3", reps: "20" }, core: { sets: "3", reps: "25" }, tag: null },
  ];
  const GEN_FLAVORS = ["Iron","Apex","Prime","Savage","Peak","Forge","Titan","Blitz","Storm","Granite","Vault","Summit","Rogue","Atlas","Vertex"];
  const GEN_COMPOUND_KW = /squat|deadlift|bench|press|\brow\b|pull-up|pull up|chin|hip thrust|lunge|clean|overhead|dip/i;

  function _rand(arr) { return arr[Math.floor(Math.random() * arr.length)]; }
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
    const hasEquip = /barbell|dumbbell|\bdb\b|\bbb\b|cable|machine|kettlebell|\bkb\b|band|ez|smith|trap[- ]bar|hex|sled|assault|treadmill|\bbike\b|rowing|jump rope|battle/i.test(name);
    const equipable = /(press|\brow\b|fly|curl|raise|extension|pushdown|pulldown|kickback|crossover|shrug|crunch|pull-through|adduction|abduction|pressdown|skull crusher|pec deck)/i.test(name);
    if (equipable && !hasEquip && Math.random() < 0.5) mods.push(_rand(["DB","DB","Cable","Cable","Machine","KB","Band"]));
    if (/(press|fly)/i.test(name) && Math.random() < 0.3) mods.push(_rand(["Incline","Decline"]));
    else if (/(\brow\b|curl|raise|extension|pushdown)/i.test(name) && Math.random() < 0.25) mods.push(_rand(["Seated","Standing"]));
    const uniOk = /(\brow\b|curl|press|extension|raise|lunge|kickback|pushdown|pulldown|split squat|step-up|carry|adduction|abduction)/i.test(name);
    const unilateral = uniOk && Math.random() < 0.22;
    if (unilateral) mods.push("1A");
    if (isPrimary && style.tag && Math.random() < 0.6) mods.push(style.tag);
    return { mods, unilateral };
  }
  function generateWorkoutDay() {
    const arch = _rand(GEN_ARCHETYPES);
    const style = _rand(GEN_STYLES);
    const pool = _exercisesForCats(arch.cats);
    if (!pool.length) return null;
    const wantMain = 4 + Math.floor(Math.random() * 2); // 4-5 main lifts
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
      const reps = unilateral ? scheme.reps + " each" : scheme.reps;
      return { name: e.name, sets: scheme.sets, reps, modifiers: mods };
    });
    return {
      name: `${_rand(GEN_FLAVORS)} ${arch.name}`,
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
        return `<span class="rec-ex-item"><strong>${escapeHtml(e.name)}</strong> ${escapeHtml(e.sets)}×${escapeHtml(e.reps)}${chips}</span>`;
      }).join(" · ");
      return `
        <div class="rec-card">
          <div class="rec-card-head">
            <div>
              <h5>${escapeHtml(day.name)} <span class="rec-gen-badge">generated</span></h5>
              <div class="rec-meta">${escapeHtml(day.focus)} · ${day.exercises.length} exercise${day.exercises.length === 1 ? "" : "s"}</div>
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
        hint = `5 freshly generated workouts — tap <strong>+ Add</strong> on any, or <button class="rec-reroll" type="button">🎲 Reroll</button> for a whole new batch.
          <div class="rec-surprise-actions"><button class="rec-add-all" type="button">➕ Add all 5 to library</button></div>`;
      } else {
        cards = RECOMMENDED_TEMPLATES[activeCat].map((t, i) => cardHtml(t, activeCat, i)).join("");
        hint = `Tap <strong>+ Add</strong> to copy a workout into your library — edit it from there anytime.`;
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
    templates.forEach((t, idx) => {
      const card = document.createElement("div");
      card.className = "template-card";
      card.style.animationDelay = `${idx * 40}ms`;
      const exCount = t.exercises?.length || 0;
      const icon = workoutIconFor(t.name);
      card.innerHTML = `
        <div class="template-card-head">
          <div class="template-card-icon">${icon}</div>
          <div style="flex:1; min-width: 0;">
            <h3>${escapeHtml(t.name)}</h3>
            ${t.focus ? `<p class="template-focus">${escapeHtml(t.focus)}</p>` : ""}
          </div>
        </div>
        <div class="template-pills">
          <span class="meta-pill">${exCount} exercise${exCount === 1 ? "" : "s"}</span>
          ${t.notes ? `<span class="meta-pill">📝 notes</span>` : ""}
        </div>
        <div class="template-actions">
          <button class="btn btn-ghost btn-sm" data-tpl-edit>Edit</button>
          <button class="btn btn-danger btn-sm" data-tpl-delete>Delete</button>
        </div>
      `;
      card.querySelector("[data-tpl-edit]").addEventListener("click", (e) => {
        e.stopPropagation();
        openTemplateEditor(t);
      });
      card.querySelector("[data-tpl-delete]").addEventListener("click", (e) => {
        e.stopPropagation();
        if (!window.confirm(`Delete day template "${t.name}"?`)) return;
        state.trainerData.workoutTemplates =
          state.trainerData.workoutTemplates.filter((x) => x.id !== t.id);
        saveTrainer();
        renderDayLibrary();
        toast("Day template deleted");
      });
      card.addEventListener("click", () => openTemplateEditor(t));
      grid.appendChild(card);
    });
  }

  function openTemplateEditor(template) {
    // Edit a deep copy so Cancel discards changes.
    const editing = !!template;
    const draft = template
      ? JSON.parse(JSON.stringify(template))
      : makeWorkoutTemplate("");
    if (!editing) draft.name = "";

    openModal({
      title: editing ? "Edit template" : "New workout template",
      body: `
        <div class="template-editor-section">
          <label>Name<input type="text" id="tpl-name" placeholder="e.g. Back Day" autofocus /></label>
          <label>Focus / theme<input type="text" id="tpl-focus" placeholder="e.g. Lats + mid back" /></label>
          <label>Notes<textarea id="tpl-notes" rows="2" placeholder="e.g. Always start with a 5 min row warm-up"></textarea></label>
        </div>
        <div class="template-editor-section">
          <h4>Exercises</h4>
          <div class="template-exercises" id="tpl-ex-list"></div>
          <button class="add-inline-btn" id="tpl-add-ex" type="button" style="margin-top:0.7em">+ Add exercise</button>
        </div>
        <p id="tpl-error" class="error hidden"></p>
      `,
      actions: [
        { label: "Cancel", className: "btn btn-ghost", onClick: closeModal },
        { label: editing ? "Save changes" : "Create template", className: "btn btn-primary",
          onClick: () => {
            const name = $("#tpl-name").value.trim();
            const err = $("#tpl-error");
            if (!name) return showErr(err, "Give the template a name.");
            draft.name = name;
            draft.focus = $("#tpl-focus").value.trim();
            draft.notes = $("#tpl-notes").value.trim();
            draft.updatedAt = Date.now();
            // Strip empty exercises (no name AND no notes) so coach can add and skip placeholders.
            draft.exercises = draft.exercises.filter((ex) =>
              (ex.name || "").trim() || (ex.notes || "").trim()
            );
            if (!draft.exercises.length) return showErr(err, "Add at least one exercise.");
            if (editing) {
              state.trainerData.workoutTemplates = state.trainerData.workoutTemplates.map((t) =>
                t.id === draft.id ? draft : t
              );
            } else {
              state.trainerData.workoutTemplates.push(draft);
            }
            saveTrainer();
            closeModal();
            renderDayLibrary();
            toast(editing ? "Template updated" : "Template created 📚");
          },
        },
      ],
    });

    // Populate fields after modal mounts.
    $("#tpl-name").value = draft.name;
    $("#tpl-focus").value = draft.focus || "";
    $("#tpl-notes").value = draft.notes || "";

    function paintExercises() {
      const wrap = $("#tpl-ex-list");
      wrap.innerHTML = "";
      draft.exercises.forEach((ex, idx) => {
        const row = document.createElement("div");
        row.className = "template-ex-row";
        row.innerHTML = `
          <div class="row-name"><input type="text" placeholder="Exercise name (e.g. Lat Pulldown)" value="${escapeHtml(ex.name || "")}" /></div>
          <div class="row-grid">
            <input type="number" min="0" placeholder="Sets" value="${escapeHtml(ex.sets || "")}" />
            <input type="number" min="0" placeholder="Reps" value="${escapeHtml(ex.currentReps || "")}" />
            <input type="text" placeholder="Notes / cue" value="${escapeHtml(ex.notes || "")}" />
            <button class="row-delete" type="button" title="Remove exercise">✕</button>
          </div>
        `;
        const [nameI, setsI, repsI, notesI] = row.querySelectorAll("input");
        nameI.addEventListener("input", () => { draft.exercises[idx].name = nameI.value; });
        setsI.addEventListener("input", () => { draft.exercises[idx].sets = setsI.value; });
        repsI.addEventListener("input", () => { draft.exercises[idx].currentReps = repsI.value; });
        notesI.addEventListener("input", () => { draft.exercises[idx].notes = notesI.value; });
        row.querySelector(".row-delete").addEventListener("click", () => {
          draft.exercises.splice(idx, 1);
          paintExercises();
        });
        wrap.appendChild(row);
      });
    }
    paintExercises();
    $("#tpl-add-ex").addEventListener("click", () => {
      draft.exercises.push(makeExercise());
      paintExercises();
    });
  }

  function openLoadTemplateModal(week, day) {
    const templates = state.trainerData.workoutTemplates || [];
    if (!templates.length) {
      toast("No templates yet — create one in Workout Library");
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
            ${t.focus ? `<span class="muted" style="margin-left:0.4em">— ${escapeHtml(t.focus)}</span>` : ""}
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
      toast("No day templates yet — build one in Workout Library");
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
            ${t.focus ? `<span class="muted" style="margin-left:0.4em">— ${escapeHtml(t.focus)}</span>` : ""}
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
    { cat: "Chest",      ex: ["Bench Press","Fly","Push-Up","Dips","Pec Deck","Pullover"] },
    { cat: "Back",       ex: ["Pull-Up","Row","Pendlay Row","Lat Pulldown","T-Bar Row","Chest-Supported Row","Straight-Arm Pulldown"] },
    { cat: "Quads",      ex: ["Back Squat","Front Squat","Leg Press","Hack Squat","Trap Bar Deadlift","Bulgarian Split Squat","Walking Lunge","Leg Extension","Step-Up","Goblet Squat","Box Squat"] },
    { cat: "Hamstrings", ex: ["Deadlift","Romanian Deadlift","Stiff-Leg Deadlift","Lying Leg Curl","Leg Curl","Nordic Curl","Good Morning","Glute-Ham Raise"] },
    { cat: "Glutes",     ex: ["Hip Thrust","Glute Bridge","Kickback","Sumo Deadlift","Abductor","Lateral Walk","Donkey Kick","Pull-Through"] },
    { cat: "Adductors",  ex: ["Hip Adduction","Copenhagen Plank","Lateral Lunge","Cossack Squat","Sumo Squat","Side-Lying Adduction"] },
    { cat: "Shoulders",  ex: ["Overhead Press","Overhead Raise","Lateral Raise","Front Raise","Rear Delt Fly","Arnold Press","Upright Row","Face Pull","Shrug","Cable Crossover"] },
    { cat: "Biceps",     ex: ["Curl","Hammer Curl","Preacher Curl","Concentration Curl","EZ-Bar Curl","Spider Curl"] },
    { cat: "Triceps",    ex: ["Tricep Pushdown","Skull Crusher","Close-Grip Bench Press","Overhead Tricep Extension","Tricep Dips","Diamond Push-Up","Kickback"] },
    { cat: "Core",       ex: ["Plank","Side Plank","Crunch","Russian Twist","Leg Raise","Hanging Leg Raise","Ab Wheel Rollout","Dead Bug","Pallof Press","Dragon Flag","Bear Crawl","Crab Crawl","Leopard Crawl","Lizard Crawl","Spiderman Crawl","Inchworm"] },
    { cat: "Calves",     ex: ["Calf Raise","Donkey Calf Raise","Leg Press Calf Raise"] },
    { cat: "Carries",    ex: ["Farmer's Carry","Suitcase Carry","Overhead Carry","Rack Carry","Zercher Carry","Trap Bar Carry","Bear Hug Carry","Bottoms-Up Carry","Waiter Walk"] },
    { cat: "Cardio",     ex: ["Treadmill Run","Stationary Bike","Rowing","Jump Rope","Sled Push","Battle Ropes","Farmer's Walk","Assault Bike","Stair Climber"] },
  ];

  function openExLibrary(day, rerenderFn) {
    _exLibraryTarget = day ? { day, rerenderFn } : null;
    show($("#ex-library-overlay"));
    renderExLibrary($("#ex-library-search").value || "");
    setTimeout(() => $("#ex-library-search").focus(), 100);
  }
  function closeExLibrary() { hide($("#ex-library-overlay")); _exLibraryTarget = null; }
  function renderExLibrary(filter) {
    const q = filter.toLowerCase().trim();
    const body = $("#ex-library-body");
    let html = "";
    for (const { cat, ex } of EXERCISE_LIBRARY) {
      const items = q ? ex.filter((e) => e.toLowerCase().includes(q)) : ex;
      if (!items.length) continue;
      html += `<div class="ex-cat-header">${escapeHtml(cat)}</div>`;
      html += items.map((name) =>
        `<div class="ex-lib-item" draggable="true" data-exname="${escapeHtml(name)}">${escapeHtml(name)}</div>`
      ).join("");
    }
    body.innerHTML = html || '<div class="ex-lib-empty">No exercises found.</div>';
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
        const { day, rerenderFn } = _exLibraryTarget;
        day.exercises.push(makeExercise({ name: item.dataset.exname }));
        saveTrainer();
        toast(`Added ${item.dataset.exname}`);
        rerenderFn();
      });
    });
  }

  // -------- Persistent Library Sidebar --------
  function renderSidebarLibrary(filter) {
    const q = (filter || "").toLowerCase().trim();
    const body = $("#ex-lib-sb-body");
    if (!body) return;
    body.innerHTML = "";
    for (const { cat, ex } of EXERCISE_LIBRARY) {
      const items = q ? ex.filter((e) => e.toLowerCase().includes(q)) : ex;
      if (!items.length) continue;
      const catEl = document.createElement("div");
      catEl.className = "ex-lib-sb-cat";
      catEl.textContent = cat;
      body.appendChild(catEl);
      items.forEach((name) => {
        const item = document.createElement("div");
        item.className = "ex-lib-sb-item";
        item.textContent = name;
        item.draggable = true;
        item.dataset.exname = name;
        item.addEventListener("dragstart", (e) => {
          item.classList.add("dragging-active");
          e.dataTransfer.setData("text/ex-name", name);
          e.dataTransfer.effectAllowed = "copy";
        });
        item.addEventListener("dragend", () => item.classList.remove("dragging-active"));
        body.appendChild(item);
      });
    }
    if (!body.children.length) {
      body.innerHTML = '<div style="padding:1rem;color:var(--muted);font-size:0.82rem">No exercises found.</div>';
    }
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

  // -------- Drum Picker (kept for fallback) --------
  const REPS_VALUES   = [...Array.from({ length: 30 }, (_, i) => String(i + 1)), "AMAP"];
  const WEIGHT_VALUES = Array.from({ length: 161 }, (_, i) => i === 0 ? "BW" : String(i * 5));
  const SETS_VALUES   = ["1","2","3","4","5","6"];
  const WEIGHT_RANGES = [
    { label: "BW",      values: ["BW"] },
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
  };
  function isSvgIcon(v) { return typeof v === "string" && Object.prototype.hasOwnProperty.call(DAY_ICON_SVGS, v); }
  function dayIconHtml(v) { return isSvgIcon(v) ? DAY_ICON_SVGS[v] : escapeHtml(v || ""); }
  function setDayIcon(el, v) { if (isSvgIcon(v)) el.innerHTML = DAY_ICON_SVGS[v]; else el.textContent = v || ""; }

  const DAY_ICON_CATEGORIES = [
    { label: "Dragons", icons: [
      "🐉","🐲","🦖","🦕","🔥","⚡","🌋","💥","⭐","🌟","✨","🛡️","⚔️","🗡️","🏹",
      "🔮","💎","👑","🦄","🐍","🦂","🕷️","🦇","👹","👺","💀","☠️","🧙","🧙‍♂️","🧝",
    ] },
    { label: "Equipment", icons: [
      "eq:barbell","eq:dumbbell","eq:kettlebell","eq:plate","eq:bench","eq:rack","eq:pullup","eq:medball",
    ] },
    { label: "Gym", icons: [
      "🏋️","🏋️‍♂️","🏋️‍♀️","💪","🦾","🤸","🤸‍♂️","🤸‍♀️","🤺","🥋","🥊","🤼","🤼‍♂️","🤼‍♀️","🧗",
      "🧗‍♂️","🧗‍♀️","🤾","🤾‍♂️","🤾‍♀️","🏃","🏃‍♂️","🏃‍♀️","🚴","🚴‍♂️","🚴‍♀️","🚵","🚵‍♂️","🚵‍♀️","🧘",
      "🧘‍♂️","🧘‍♀️","🤹","🤹‍♂️","🤹‍♀️","⛹️","⛹️‍♂️","⛹️‍♀️","🦵","🦶",
    ] },
    { label: "Cardio", icons: [
      "🏊","🏊‍♂️","🏊‍♀️","🤽","🤽‍♂️","🤽‍♀️","🏄","🏄‍♂️","🏄‍♀️","🚣","🚣‍♂️","🚣‍♀️","⛷️","🏂","🛷",
      "🥌","⛸️","🛹","🛼","🤿","🎿","🏇","🐎","🏆","🥇","🥈","🥉","🏅","🎖️","🎗️",
      "⏱️","⏲️","🎯","🏁","🚩","🏳️","🥅","🔔","📣","🎽",
    ] },
    { label: "Sport", icons: [
      "⚽","🏀","🏈","⚾","🥎","🎾","🏐","🏉","🥏","🎳","🏏","🏑","🏒","🥍","🏓",
      "🏸","🪀","🪁","🎱","🥊","🥋","🏹","🎣","🛶","⛳","🏌️","🏌️‍♂️","🏌️‍♀️","🎿","🪃",
    ] },
    { label: "Food", icons: [
      "🍎","🍏","🍌","🍊","🍋","🍇","🍓","🫐","🍍","🥝","🥑","🥦","🥕","🌽","🥔",
      "🍠","🥜","🌰","🍞","🥖","🥨","🧀","🥚","🍳","🥓","🥩","🍗","🍖","🌭","🍔",
      "🍟","🍕","🥪","🌮","🌯","🥗","🍝","🍜","🍲","🍛","🍣","🍱","🥘","🍤","🍙",
      "🍚","🍥","🥟","🍢","🍡","🍦","🍩","🍪","🎂","🍰","🧁","🍫","🍬","🍭","🍯",
    ] },
    { label: "Fuel", icons: [
      "🥛","🧃","🧋","☕","🍵","🥤","🧊","🥥","💧","🍺","🛌","😴","🧖","🧖‍♂️","🧖‍♀️",
      "🩹","💊","🧴","🛁","🚿",
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
    if (currentVal && currentVal !== "BW") {
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
        btn.textContent = v === "BW" ? "BW" : v + " lb";
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

  let _drumVals = [];
  let _drumCb   = null;

  function openDrumPicker(label, values, currentVal, cb) {
    _drumVals = values;
    _drumCb   = cb;
    $("#drum-label").textContent = label;
    const scroll = $("#drum-scroll");
    scroll.innerHTML =
      '<div class="drum-spacer"></div>' +
      values.map((v) => `<div class="drum-item">${escapeHtml(String(v))}</div>`).join("") +
      '<div class="drum-spacer"></div>';
    show($("#drum-modal"));
    const idx = values.indexOf(String(currentVal));
    const scrollTo = (idx >= 0 ? idx : 0) * 48;
    requestAnimationFrame(() => { scroll.scrollTop = scrollTo; });
  }
  function confirmDrum() {
    const scroll = $("#drum-scroll");
    const idx = Math.round(scroll.scrollTop / 48);
    const val = _drumVals[Math.max(0, Math.min(idx, _drumVals.length - 1))];
    hide($("#drum-modal"));
    if (_drumCb) { _drumCb(val); _drumCb = null; }
  }
  function cancelDrum() { hide($("#drum-modal")); _drumCb = null; }

  function pickerBtnEl(value, emptyLabel, openFn) {
    const btn = document.createElement("button");
    btn.className = "picker-btn" + (value ? "" : " empty");
    btn.textContent = value || emptyLabel;
    btn.addEventListener("click", openFn);
    return btn;
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
    if (c.weeks.length === 0) { show(empty); return; }
    hide(empty);
    _coachActiveWeekIdx = Math.min(_coachActiveWeekIdx, c.weeks.length - 1);
    renderCoachWeekTabs(c.weeks, container);
    renderArchiveSection(c);
  }

  function renderCoachWeekTabs(weeks, container, showAdd = true) {
    // ── Tab strip ──
    const strip = document.createElement("div");
    strip.className = "coach-week-tab-strip";

    weeks.forEach((week, wIdx) => {
      const tab = document.createElement("button");
      tab.className = "coach-week-tab" + (wIdx === _coachActiveWeekIdx ? " active" : "");
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
      week.days.forEach((day, dIdx) => {
        const tab = document.createElement("button");
        tab.className = "day-tab" + (dIdx === week._activeDayIdx ? " active" : "");
        tab.textContent = day.name || `Day ${dIdx + 1}`;
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
        p.textContent = "No training days yet — click + Day to add one, or 📥 Library to import a saved day.";
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
      label: "Archived — " + label,
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
      <span class="archive-week-label">${week.phaseLabel ? `<span class="phase-badge">${escapeHtml(week.phaseLabel)}</span> ` : ""}${escapeHtml(week.label)}${week.focus ? " — " + escapeHtml(week.focus) : ""}</span>
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
      week.days.forEach((day, dIdx) => {
        const tab = document.createElement("button");
        tab.className = "day-tab" + (dIdx === week._activeDayIdx ? " active" : "");
        tab.textContent = day.name || `Day ${dIdx + 1}`;
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
        p.textContent = "No training days yet — click + Day to add one.";
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

  function renderDayContent(week, day, rerenderFn) {
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
    actionBar.appendChild(delDayBtn);

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

    day.exercises.forEach((ex) => list.appendChild(renderExerciseRow(day, ex, rerenderFn)));

    // Always show a drop zone — big when empty, slim hint when exercises exist
    const dropHint = document.createElement("div");
    dropHint.className = day.exercises.length === 0 ? "ex-list-empty-drop" : "ex-list-drop-hint";
    dropHint.textContent = day.exercises.length === 0 ? "Drag exercises from the library →" : "drag to add more";
    dropHint.setAttribute("aria-hidden", "true");
    list.appendChild(dropHint);

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

    // Modifier chips BEFORE name (Unilateral, Equipment, Position)
    const chipsBefore = document.createElement("div");
    chipsBefore.className = "mod-chips-before";
    renderModChips(chipsBefore, ex, "before");

    // Name
    const nameInput = document.createElement("input");
    nameInput.type = "text";
    nameInput.className = "ex-name-compact";
    nameInput.placeholder = "Exercise name…";
    nameInput.value = ex.name || "";
    nameInput.addEventListener("input", () => { ex.name = nameInput.value; saveTrainer(); });

    // Modifier chips AFTER name (Style)
    const chipsAfter = document.createElement("div");
    chipsAfter.className = "mod-chips-after";
    renderModChips(chipsAfter, ex, "after");

    // Modifier picker button
    const modBtn = document.createElement("button");
    modBtn.className = "mod-add-btn";
    modBtn.title = "Add/remove modifiers (1A, DB, Pause…)";
    modBtn.textContent = "tag";
    modBtn.addEventListener("click", (e) => { e.stopPropagation(); openModPicker(ex, modBtn, chipsBefore, chipsAfter); });

    function wtLabel(v) { return v ? (v === "BW" ? "BW" : v + " lb") : null; }

    // Sets
    const setsBtn = document.createElement("button");
    setsBtn.className = "picker-btn picker-btn-sm" + (ex.sets ? "" : " empty");
    setsBtn.textContent = ex.sets || "—";
    setsBtn.title = "Sets";
    setsBtn.addEventListener("click", (e) => { e.stopPropagation(); openGridPicker("Sets", SETS_VALUES, ex.sets || "3", (val) => {
      ex.sets = val; saveTrainer(); setsBtn.textContent = val; setsBtn.classList.remove("empty");
    }, setsBtn); });

    const at = document.createElement("span");
    at.className = "ex-row-sep"; at.textContent = "@";

    // Prescribed weight (lower)
    const cwBtn = document.createElement("button");
    cwBtn.className = "picker-btn picker-btn-sm" + (ex.currentWeight ? "" : " empty");
    cwBtn.textContent = wtLabel(ex.currentWeight) || "Wt";
    cwBtn.title = "Prescribed weight (lower)";
    cwBtn.addEventListener("click", (e) => { e.stopPropagation(); openWeightPicker(ex.currentWeight || "BW", (val) => {
      ex.currentWeight = val; saveTrainer(); cwBtn.textContent = wtLabel(val) || "Wt"; cwBtn.classList.toggle("empty", !val);
    }, cwBtn); });

    const dash = document.createElement("span");
    dash.className = "ex-row-sep"; dash.textContent = "–";

    // Prescribed weight (upper / range)
    const gwBtn = document.createElement("button");
    gwBtn.className = "picker-btn picker-btn-sm" + (ex.goalWeight ? "" : " empty");
    gwBtn.textContent = wtLabel(ex.goalWeight) || "Wt";
    gwBtn.title = "Prescribed weight (upper)";
    gwBtn.addEventListener("click", (e) => { e.stopPropagation(); openWeightPicker(ex.goalWeight || ex.currentWeight || "BW", (val) => {
      ex.goalWeight = val; saveTrainer(); gwBtn.textContent = wtLabel(val) || "Wt"; gwBtn.classList.toggle("empty", !val);
    }, gwBtn); });

    const x1 = document.createElement("span");
    x1.className = "ex-row-sep"; x1.textContent = "×";

    // Prescribed reps
    const crBtn = document.createElement("button");
    crBtn.className = "picker-btn picker-btn-sm" + (ex.currentReps ? "" : " empty");
    crBtn.textContent = ex.currentReps || "—";
    crBtn.title = "Prescribed reps";
    crBtn.addEventListener("click", (e) => { e.stopPropagation(); openGridPicker("Reps", REPS_VALUES, ex.currentReps || "8", (val) => {
      ex.currentReps = val; saveTrainer(); crBtn.textContent = val; crBtn.classList.toggle("empty", !val);
    }, crBtn, 6); });

    // Finisher (burnout / dropset) — sits at the end of the sets cluster.
    const finisherBtn = document.createElement("button");
    finisherBtn.className = "picker-btn picker-btn-sm ex-finisher-btn";
    finisherBtn.title = "Burnout / Dropset finisher";
    const refreshFinisherBtn = () => {
      const sum = finisherSummary(ex);
      finisherBtn.textContent = sum || "＋ Fin";
      finisherBtn.classList.toggle("empty", !sum);
    };
    refreshFinisherBtn();
    finisherBtn.addEventListener("click", (e) => { e.stopPropagation(); openFinisherPicker(ex, finisherBtn, refreshFinisherBtn); });

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
      gwBtn.disabled = locked;
      crBtn.disabled = locked;
      finisherBtn.disabled = locked;
      handle.style.opacity = locked ? "0.3" : "";
      handle.style.pointerEvents = locked ? "none" : "";
      moveUpBtn.disabled = locked;
      moveDownBtn.disabled = locked;
      chipsBefore.style.pointerEvents = locked ? "none" : "";
      chipsAfter.style.pointerEvents = locked ? "none" : "";
      saveBtn.classList.toggle("hidden", locked);
      editBtn.classList.toggle("hidden", !locked);
    }

    saveBtn.addEventListener("click", () => { ex.locked = true;  saveTrainer(); applyLock(true); });
    editBtn.addEventListener("click", () => { ex.locked = false; saveTrainer(); applyLock(false); });
    applyLock(!!ex.locked);

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
    const metricsGroup = document.createElement("div");
    metricsGroup.className = "ex-metrics-group";
    metricsGroup.appendChild(setsBtn); metricsGroup.appendChild(at);
    metricsGroup.appendChild(cwBtn); metricsGroup.appendChild(dash); metricsGroup.appendChild(gwBtn);
    metricsGroup.appendChild(x1); metricsGroup.appendChild(crBtn);
    metricsGroup.appendChild(finisherBtn);

    row.appendChild(handle);
    row.appendChild(moveUpBtn);
    row.appendChild(moveDownBtn);
    row.appendChild(chipsBefore);
    row.appendChild(nameInput);
    row.appendChild(chipsAfter);
    row.appendChild(modBtn);
    row.appendChild(metricsGroup);
    row.appendChild(expandBtn); row.appendChild(saveBtn); row.appendChild(editBtn); row.appendChild(delBtn);

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

    detail.appendChild(notesTA);
    detail.appendChild(videoInput);

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
      const rect = wrapper.getBoundingClientRect();
      wrapper.classList.remove("drag-above", "drag-below");
      wrapper.classList.add(e.clientY < rect.top + rect.height / 2 ? "drag-above" : "drag-below");
    });
    wrapper.addEventListener("dragleave", () => wrapper.classList.remove("drag-above", "drag-below"));
    wrapper.addEventListener("drop", (e) => {
      e.preventDefault(); wrapper.classList.remove("drag-above", "drag-below");
      try {
        const { exId, dayId } = JSON.parse(e.dataTransfer.getData("text/ex-reorder"));
        if (dayId !== day.id || exId === ex.id) return;
        const rect = wrapper.getBoundingClientRect();
        const insertAfter = e.clientY >= rect.top + rect.height / 2;
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

  // -------- 12-week template (generic phased periodization) --------
  function loadTemplate() {
    const c = currentClient(); if (!c) return;
    if (c.weeks.length > 0) {
      if (!window.confirm("This will replace the existing program with the 12-week template. Continue?")) return;
    }
    c.weeks = buildTemplateWeeks();
    saveTrainer();
    renderWeeks(); renderDiet(); renderCoachCalendar();
    toast("12-week template loaded");
  }

  function buildTemplateWeeks() {
    // Four phases × 3 weeks. Standard periodization model:
    // Foundation → Hypertrophy → Maximal Strength → Peak (Power).
    // Exercise selections are common compound + accessory movements
    // any strength coach would prescribe. Coach should personalize weights.
    const phases = [
      {
        label: "Foundation",
        focus: "Anatomical adaptation, movement quality, base volume",
        scheme: { setsCompound: "3", repsCompound: "10", setsAccessory: "3", repsAccessory: "12" },
        cue: "Moderate loads (~65% 1RM). Focus on form, tempo, and full ROM. Build base work capacity.",
      },
      {
        label: "Hypertrophy",
        focus: "Drive muscle growth with higher volume",
        scheme: { setsCompound: "4", repsCompound: "8", setsAccessory: "3", repsAccessory: "12" },
        cue: "~70–75% 1RM. Push every set to within 1–2 reps of failure (RPE 8). 60–90 sec rest on accessories.",
      },
      {
        label: "Strength",
        focus: "Build maximal strength with heavier loads",
        scheme: { setsCompound: "5", repsCompound: "5", setsAccessory: "3", repsAccessory: "8" },
        cue: "~80–87% 1RM. Long rest (2–3 min) on compounds. Add 5 lb week-to-week when all reps clean.",
      },
      {
        label: "Peak",
        focus: "Intensify, test top sets, then deload final week",
        scheme: { setsCompound: "5", repsCompound: "3", setsAccessory: "3", repsAccessory: "6" },
        cue: "~88–92% 1RM. Top single allowed in week 11. Week 12 = deload at 60% for recovery.",
      },
    ];

    // 4 training days, body-part split — universal pattern in strength coaching
    const dayTemplates = [
      {
        name: "Day 1 — Lower Body (Squat focus)",
        exercises: [
          { name: "Back Squat", role: "compound" },
          { name: "Romanian Deadlift", role: "compound" },
          { name: "Walking Lunges", role: "accessory" },
          { name: "Leg Curl", role: "accessory" },
          { name: "Standing Calf Raise", role: "accessory" },
        ],
      },
      {
        name: "Day 2 — Upper Push (Chest / Shoulders / Triceps)",
        exercises: [
          { name: "Bench Press", role: "compound" },
          { name: "Overhead Press", role: "compound" },
          { name: "Incline Dumbbell Press", role: "accessory" },
          { name: "Lateral Raise", role: "accessory" },
          { name: "Triceps Pressdown", role: "accessory" },
        ],
      },
      {
        name: "Day 3 — Lower Body (Deadlift focus)",
        exercises: [
          { name: "Deadlift", role: "compound" },
          { name: "Front Squat", role: "compound" },
          { name: "Bulgarian Split Squat", role: "accessory" },
          { name: "Hip Thrust", role: "accessory" },
          { name: "Hanging Knee Raise", role: "accessory" },
        ],
      },
      {
        name: "Day 4 — Upper Pull (Back / Biceps)",
        exercises: [
          { name: "Pull-up (or Lat Pulldown)", role: "compound" },
          { name: "Barbell Row", role: "compound" },
          { name: "Seated Cable Row", role: "accessory" },
          { name: "Face Pull", role: "accessory" },
          { name: "Barbell Curl", role: "accessory" },
        ],
      },
    ];

    const weeks = [];
    let weekIdx = 0;
    phases.forEach((phase) => {
      for (let pw = 1; pw <= 3; pw++) {
        const week = {
          id: uid(),
          label: `Week ${weekIdx + 1}`,
          focus: phase.focus + (pw === 3 ? " (intensification)" : pw === 1 ? " (intro)" : ""),
          phaseLabel: phase.label,
          days: dayTemplates.map((dt, di) => ({
            id: uid(),
            name: dt.name,
            exercises: dt.exercises.map((e) => {
              const isCompound = e.role === "compound";
              return {
                id: uid(),
                name: e.name,
                sets: isCompound ? phase.scheme.setsCompound : phase.scheme.setsAccessory,
                currentWeight: "",
                currentReps: isCompound ? phase.scheme.repsCompound : phase.scheme.repsAccessory,
                goalWeight: "",
                goalReps: "",
                notes: isCompound
                  ? `${phase.label} phase. ${phase.cue}`
                  : "Controlled tempo, full ROM. Pair with main lift; 60–90 sec rest.",
              };
            }),
          })),
          diet: {
            notes: phase.label === "Hypertrophy"
              ? "Slight surplus (~+250 kcal) to support growth. Protein 0.9–1.0 g per lb bodyweight."
              : phase.label === "Strength"
              ? "Maintenance to small surplus. Eat enough carbs around training to fuel heavy sessions."
              : phase.label === "Peak"
              ? "Maintenance. Prioritize sleep, hydration, recovery."
              : "Eat at maintenance. Protein 0.8 g per lb bodyweight minimum.",
            calories: "",
            protein: "",
          },
        };
        weeks.push(week);
        weekIdx++;
      }
    });
    return weeks;
  }

  // -------- Diet --------
  const DAY_LABELS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];

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
        paths += `<path d="${donutArcPath(cx, cy, rO, rI, a0, a1)}" fill="${p.color}"><title>${p.label} — ${p.grams} g · ${p.kcal.toLocaleString()} kcal · ${p.pct}%</title></path>`;
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
      ? `<p class="muted macro-mismatch">Macros add up to ${totalKcal.toLocaleString()} kcal — the calorie target says ${calTarget.toLocaleString()}.</p>`
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
      const list = document.createElement("div");
      list.className = "log-table";
      list.innerHTML = `<div class="lh">Date</div><div class="lh">Weight</div><div></div><div></div>`;
      [...bwLog].sort((a, b) => b.date.localeCompare(a.date)).forEach((b) => {
        list.insertAdjacentHTML("beforeend",
          `<div class="date">${escapeHtml(b.date)}</div><div>${escapeHtml(b.weightLb)} lb</div><div></div><div></div>`);
      });
      bwCard.appendChild(list);
    } else {
      bwCard.insertAdjacentHTML("beforeend",
        `<p class="muted" style="margin:0.2em 0 0">No weight entries yet — ${escapeHtml(c.name)} hasn't logged any body weight.</p>`);
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

  // Status for an athlete (uses progress logs) - returns: 'done' | 'partial' | 'missed' | 'scheduled' | 'rest' | null
  function dayStatusForCoach(c, dateISOStr) {
    const sched = c.schedule?.[dateISOStr];
    if (!sched) return null;
    if (sched.rest) return "rest";
    const wd = findWeekDay(c, sched.weekId, sched.dayId);
    if (!wd) return "scheduled";

    const logs = c.importedProgress?.exerciseLogs || {};
    const totalEx = wd.day.exercises.length;
    let doneEx = 0;
    wd.day.exercises.forEach((ex) => {
      const exLogs = logs[ex.id] || [];
      if (exLogs.some((l) => l.date === dateISOStr)) doneEx++;
    });
    if (doneEx >= totalEx && totalEx > 0) return "done";
    if (doneEx > 0) return "partial";
    if (dateISOStr < todayISO()) return "missed";
    return "scheduled";
  }

  function dayStatusForAthlete(program, progress, dateISOStr) {
    const sched = program.client.schedule?.[dateISOStr];
    if (!sched) return null;
    if (sched.rest) return "rest";
    const wd = findWeekDay(program.client, sched.weekId, sched.dayId);
    if (!wd) return "scheduled";
    const logs = progress?.exerciseLogs || {};
    const totalEx = wd.day.exercises.length;
    let doneEx = 0;
    wd.day.exercises.forEach((ex) => {
      const exLogs = logs[ex.id] || [];
      if (exLogs.some((l) => l.date === dateISOStr)) doneEx++;
    });
    if (doneEx >= totalEx && totalEx > 0) return "done";
    if (doneEx > 0) return "partial";
    if (dateISOStr < todayISO()) return "missed";
    return "scheduled";
  }

  function dayLabel(c, sched) {
    if (!sched) return "";
    if (sched.rest) return "Rest";
    const wd = findWeekDay(c, sched.weekId, sched.dayId);
    if (!wd) return "—";
    return `${wd.week.label} · ${wd.day.name.split(" — ")[0] || wd.day.name}`;
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
    const label = reds.length > 1 ? `🎟 ×${reds.length}` : "🎟 Session used";
    const notes = reds.map((r) => r.note).filter(Boolean).join(" · ");
    return `<div class="cal-day-pill cal-day-pill-token" title="${escapeHtml(notes)}">${label}</div>`;
  }
  function openRedemptionDetailsModal(iso, reds) {
    const items = reds.map((r) =>
      `<li>${r.note ? escapeHtml(r.note) : `<span class="muted">No note</span>`}</li>`).join("");
    openModal({
      title: `🎟 Session used — ${iso}`,
      body: `
        <p class="muted" style="margin-top:-0.4em">${reds.length > 1
          ? `${reds.length} workout session tokens were`
          : "A workout session token was"} redeemed on this day.</p>
        <ul class="redemption-note-list">${items}</ul>`,
      actions: [{ label: "Close", className: "btn btn-ghost", onClick: closeModal }],
    });
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
      reds.push({
        id: uid(), date,
        note: `Booked session · ${fmtSetmoreTime(e.startAt)}`,
        setmoreUid: e.uid,
      });
      spent.push(c);
    });
    if (!spent.length) return;
    localStorage.setItem(KEY_TRAINER, JSON.stringify(state.trainerData));
    // Push each charged athlete (saveTrainer only pushes the open one)
    if (window.Cloud?.enabled) {
      spent.forEach((c) => window.Cloud.debounce(`athlete:${c.id}`, () =>
        window.Cloud.upsertAthlete(c, state.trainerData.coachId)
      ));
    }
    toast(`🎟 Session token spent — ${spent.map((c) => c.name).join(", ")}`);
    if (state.currentClientId && spent.some((c) => c.id === state.currentClientId)) {
      renderCoachSessions();
      renderCoachCalendar();
    }
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
          body += `<div class="breakdown-ex dash-booked-row dash-booked-linked" data-open-athlete="${escapeHtml(athlete.id)}">
            <div class="breakdown-ex-name">${escapeHtml(athlete.name)}
              <span class="booked-balance-chip${sum.remaining <= 0 ? " low" : ""}">🎟 ${sum.remaining} left</span>
            </div>
            <div class="breakdown-sets">${time}<span class="dash-booked-arrow">›</span></div>
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
      title: `${escapeHtml(day.name)} — ${iso}`,
      body: bodyHtml,
      actions: [{ label: "Close", className: "btn btn-ghost", onClick: closeModal }],
    });
  }

  function attachDayVideoButton(cell, videos, dayLabelStr) {
    const btn = document.createElement("button");
    btn.className = "cal-day-video";
    btn.type = "button";
    btn.innerHTML = `▶ ${videos.length}`;
    btn.title = `${videos.length} demo${videos.length === 1 ? "" : "s"} available`;
    btn.addEventListener("click", (e) => {
      e.stopPropagation();
      openDayVideoPicker(videos, dayLabelStr);
    });
    cell.appendChild(btn);
  }

  function openScheduleModal(iso) {
    const c = currentClient(); if (!c) return;
    const existing = c.schedule[iso] || {};
    const weekOpts = c.weeks.map((w) =>
      `<option value="${w.id}" ${existing.weekId === w.id ? "selected" : ""}>${escapeHtml((w.phaseLabel ? "[" + w.phaseLabel + "] " : "") + w.label)}</option>`
    ).join("");
    openModal({
      title: `Schedule for ${iso}`,
      body: `
        <div class="sched-options">
          <label>Type
            <select id="sched-type">
              <option value="workout" ${existing.weekId ? "selected" : ""}>Workout day</option>
              <option value="rest" ${existing.rest ? "selected" : ""}>Rest day</option>
              <option value="clear" ${!existing.weekId && !existing.rest ? "selected" : ""}>(Unscheduled)</option>
            </select>
          </label>
          <div id="sched-workout-fields" ${existing.rest ? 'class="hidden"' : ""}>
            <label>Week
              <select id="sched-week">${weekOpts || '<option value="">(no weeks yet — add a week first)</option>'}</select>
            </label>
            <label>Day
              <select id="sched-day"></select>
            </label>
          </div>
        </div>`,
      actions: [
        { label: "Cancel", className: "btn btn-ghost", onClick: closeModal },
        ...(c.schedule[iso] ? [{
          label: "Clear", className: "btn btn-danger", onClick: () => {
            delete c.schedule[iso];
            saveTrainer(); renderCoachCalendar(); closeModal();
            toast("Cleared");
          },
        }] : []),
        { label: "Save", className: "btn btn-primary", onClick: () => {
            const type = $("#sched-type").value;
            if (type === "clear") {
              delete c.schedule[iso];
            } else if (type === "rest") {
              c.schedule[iso] = { rest: true };
            } else {
              const weekId = $("#sched-week").value;
              const dayId = $("#sched-day").value;
              if (!weekId || !dayId) { toast("Pick a week & day"); return; }
              c.schedule[iso] = { weekId, dayId };
            }
            saveTrainer(); renderCoachCalendar(); closeModal();
            toast("Schedule saved");
          },
        },
      ],
    });

    const typeSel = $("#sched-type");
    const wfields = $("#sched-workout-fields");
    const weekSel = $("#sched-week");
    const daySel = $("#sched-day");
    function rebuildDays() {
      const w = c.weeks.find((x) => x.id === weekSel.value);
      daySel.innerHTML = w ? w.days.map((d) =>
        `<option value="${d.id}" ${existing.dayId === d.id ? "selected" : ""}>${escapeHtml(d.name)}</option>`
      ).join("") : "";
    }
    rebuildDays();
    typeSel.addEventListener("change", () => {
      if (typeSel.value === "workout") wfields.classList.remove("hidden");
      else wfields.classList.add("hidden");
    });
    weekSel?.addEventListener("change", rebuildDays);
  }

  // -------- Client logs view --------
  function renderClientLogs() {
    const c = currentClient(); if (!c) return;
    const container = $("#logs-container");
    const empty = $("#logs-empty");
    container.innerHTML = "";
    const p = c.importedProgress;
    if (!p || (!p.bodyweightLog?.length && !Object.keys(p.exerciseLogs || {}).length && !p.feedback && !Object.keys(p.dayCompletions || {}).length && !p.cardioLogs?.length)) {
      show(empty); return;
    }
    hide(empty);

    // Cardio the athlete has logged
    if (p.cardioLogs?.length) {
      const cardioCard = document.createElement("div");
      cardioCard.className = "log-week-card";
      cardioCard.innerHTML = `<h4>Cardio</h4>`;
      [...p.cardioLogs]
        .sort((a, b) => (b.date || "").localeCompare(a.date || ""))
        .slice(0, 15)
        .forEach((log) => {
          const row = document.createElement("div");
          row.className = "cardio-row cardio-row-readonly";
          row.innerHTML = `
            <span class="cardio-row-icon">${cardioIcon(log.type)}</span>
            <div class="cardio-row-info">
              <strong>${escapeHtml(log.type || "Cardio")}</strong>
              <span class="muted">${escapeHtml(log.date || "")}</span>
            </div>
            <span class="cardio-min">${escapeHtml(String(log.minutes || 0))} min</span>
            <span class="cardio-intensity cardio-intensity-${escapeHtml((log.intensity || "moderate").toLowerCase())}">${escapeHtml(log.intensity || "Moderate")}</span>`;
          cardioCard.appendChild(row);
        });
      container.appendChild(cardioCard);
    }

    // Day completion summary per week
    if (p.dayCompletions && Object.keys(p.dayCompletions).length) {
      const summary = document.createElement("div");
      summary.className = "log-week-card";
      summary.innerHTML = `<h4>Day completions</h4>`;
      let anyRendered = false;
      c.weeks.forEach((w) => {
        const totalDays = w.days.length;
        const completedDays = w.days.filter((d) => (p.dayCompletions[d.id] || []).length > 0).length;
        if (completedDays === 0) return;
        anyRendered = true;
        const pct = totalDays ? Math.round((completedDays * 100) / totalDays) : 0;
        const row = document.createElement("div");
        row.className = "log-week-row";
        row.innerHTML = `
          <div class="log-week-row-label">
            ${w.phaseLabel ? `<span class="phase-badge">${escapeHtml(w.phaseLabel)}</span>` : ""}
            <strong>${escapeHtml(w.label)}</strong>
            <span class="muted">— ${completedDays}/${totalDays} days</span>
          </div>
          <div class="week-progress-track" style="flex:1; max-width: 240px"><div class="week-progress-fill" style="width:${pct}%"></div></div>
          <div class="week-progress-pct">${pct}%</div>`;
        summary.appendChild(row);
      });
      if (anyRendered) container.appendChild(summary);
    }
    if (p.feedback) {
      const fb = document.createElement("div");
      fb.className = "client-feedback-block";
      fb.innerHTML = `
        <div class="feedback-label">Note from ${escapeHtml(c.name)}${p.syncedAt ? " · synced " + new Date(p.syncedAt).toLocaleString() : ""}</div>
        ${escapeHtml(p.feedback)}`;
      container.appendChild(fb);
    }
    if (p.dayNotes && Object.keys(p.dayNotes).some((k) => p.dayNotes[k]?.trim())) {
      const notesCard = document.createElement("div");
      notesCard.className = "log-week-card";
      notesCard.innerHTML = `<h4>Session notes from ${escapeHtml(c.name)}</h4>`;
      let anyNote = false;
      c.weeks.forEach((w) => {
        w.days.forEach((d) => {
          const note = (p.dayNotes[d.id] || "").trim();
          if (!note) return;
          anyNote = true;
          const row = document.createElement("div");
          row.className = "day-note-coach-row";
          row.innerHTML = `<div class="day-note-coach-day">${escapeHtml(w.label)} · ${escapeHtml(d.name)}</div>
            <div class="day-note-coach-text">${escapeHtml(note)}</div>`;
          notesCard.appendChild(row);
        });
      });
      if (anyNote) container.appendChild(notesCard);
    }
    if (p.exerciseLogs && Object.keys(p.exerciseLogs).length) {
      c.weeks.forEach((w) => {
        const exsWithLogs = [];
        w.days.forEach((d) => {
          d.exercises.forEach((ex) => {
            const logs = p.exerciseLogs[ex.id];
            if (logs?.length) exsWithLogs.push({ day: d, ex, logs });
          });
        });
        if (!exsWithLogs.length) return;
        const wCard = document.createElement("div");
        wCard.className = "log-week-card";
        wCard.innerHTML = `<h4>${w.phaseLabel ? `<span class="phase-badge">${escapeHtml(w.phaseLabel)}</span>` : ""}${escapeHtml(w.label)}${w.focus ? " — " + escapeHtml(w.focus) : ""}</h4>`;
        exsWithLogs.forEach(({ day, ex, logs }) => {
          const sec = document.createElement("div");
          sec.className = "log-exercise";
          const rows = [...logs].sort((a, b) => b.date.localeCompare(a.date)).map((l) => `
            <div class="date">${escapeHtml(l.date)}</div>
            <div>${escapeHtml(l.weight || "—")}</div>
            <div>${escapeHtml(l.reps || "—")}</div>
            <div>${escapeHtml(l.sets || "—")}</div>
            ${l.notes ? `<div style="grid-column: 1 / -1; color: var(--text-soft); font-size: 0.85rem; padding-bottom: 0.3em;">${escapeHtml(l.notes)}</div>` : ""}
          `).join("");
          sec.innerHTML = `
            <h5>${escapeHtml(ex.name || "(unnamed)")} <span class="muted">— ${escapeHtml(day.name)}</span></h5>
            <div class="log-table">
              <div class="lh">Date</div><div class="lh">Weight</div><div class="lh">Reps</div><div class="lh">Sets</div>
              ${rows}
            </div>`;
          wCard.appendChild(sec);
        });
        container.appendChild(wCard);
      });
    }
  }

  // -------- Personal Records --------
  function groupPRs(prs) {
    // Group by lowercase name, retain original-case display name from first entry
    const groups = new Map();
    prs.forEach((p) => {
      if (!p.name) return;
      const k = p.name.trim().toLowerCase();
      if (!groups.has(k)) groups.set(k, { displayName: p.name.trim(), entries: [] });
      groups.get(k).entries.push(p);
    });
    return Array.from(groups.values()).sort((a, b) => a.displayName.localeCompare(b.displayName));
  }
  function prSortKey(p) {
    const w = Number(p.weight);
    return isNaN(w) ? -1 : w;
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
      ${best && best.weight ? `<span class="pr-best"><span class="pr-best-label">PR</span>${escapeHtml(best.weight)} lb × ${escapeHtml(best.reps || "?")}</span>` : ""}
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
          <div><span class="pr-weight">${escapeHtml(p.weight || "—")} lb</span> <span class="pr-reps">× ${escapeHtml(p.reps || "—")} reps</span></div>
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
    if (!hasAnything) { show(emptyEl); return; }
    hide(emptyEl);

    // Coach-managed cards (editable)
    nameMap.forEach((entry, key) => {
      const inEdit = _prEditIds.has(entry.id) || !(entry.pr1 || entry.pr2 || entry.pr3);
      container.appendChild(buildCoachPRCard(c, entry, inEdit, false, athleteBestMap.get(key)));
    });

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

  function buildCoachPRCard(c, entry, inEdit, isNew, athletePR) {
    const card = document.createElement("div");
    card.className = "pr-edit-card" + (inEdit ? " is-editing" : "");

    if (inEdit) {
      card.innerHTML = `
        ${isNew
          ? `<div class="pr-edit-name-row"><input class="pr-name-input" placeholder="Exercise name…" value="${escapeHtml(entry.name || "")}"></div>`
          : `<div class="pr-edit-name">${escapeHtml(entry.name)}</div>`}
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

      if (!isNew) {
        card.querySelector(".pr-1rm-input").value = entry.pr1 || "";
        card.querySelector(".pr-2rm-input").value = entry.pr2 || "";
        card.querySelector(".pr-3rm-input").value = entry.pr3 || "";
      }

      card.querySelector(".pr-save-btn").addEventListener("click", () => {
        const newName = isNew ? (card.querySelector(".pr-name-input")?.value.trim() || "") : entry.name;
        const pr1 = card.querySelector(".pr-1rm-input").value.trim();
        const pr2 = card.querySelector(".pr-2rm-input").value.trim();
        const pr3 = card.querySelector(".pr-3rm-input").value.trim();
        if (!newName) { toast("Enter a lift name"); return; }
        if (!pr1 && !pr2 && !pr3) { toast("Enter at least one PR"); return; }
        if (isNew) {
          c.coachPRs.push({ id: uid(), name: newName, pr1, pr2, pr3 });
          _prNewLifts = _prNewLifts.filter(nl => nl.tempId !== entry.id);
        } else {
          const real = c.coachPRs.find(p => p.id === entry.id);
          if (real) { real.pr1 = pr1; real.pr2 = pr2; real.pr3 = pr3; real.date = todayISO(); }
          _prEditIds.delete(entry.id);
        }
        saveTrainer();
        renderCoachPRs();
      });

      card.querySelector(".pr-cancel-btn").addEventListener("click", () => {
        if (isNew) {
          _prNewLifts = _prNewLifts.filter(nl => nl.tempId !== entry.id);
        } else {
          _prEditIds.delete(entry.id);
        }
        renderCoachPRs();
      });
    } else {
      const rmPill = (label, val) => val
        ? `<span class="pr-rm-pill"><span class="pr-rm-label">${label}</span>${escapeHtml(val)} lb</span>`
        : `<span class="pr-rm-pill pr-rm-empty"><span class="pr-rm-label">${label}</span>—</span>`;
      card.innerHTML = `
        <div class="pr-view-header">
          <h4 class="pr-exercise-name">${escapeHtml(entry.name)}</h4>
          <div class="pr-view-btns">
            <button class="pr-edit-btn btn btn-ghost btn-sm">Edit</button>
            <button class="pr-delete-btn" title="Delete">×</button>
          </div>
        </div>
        <div class="pr-rm-row">
          ${rmPill("1RM", entry.pr1)}
          ${rmPill("2RM", entry.pr2)}
          ${rmPill("3RM", entry.pr3)}
        </div>
        ${athletePR ? `
          <div class="pr-athlete-row">
            <span class="pr-author athlete">athlete</span>
            <span>${escapeHtml(athletePR.weight || "—")} lb × ${escapeHtml(athletePR.reps || "—")} reps</span>
          </div>` : ""}`;

      card.querySelector(".pr-edit-btn").addEventListener("click", () => {
        _prEditIds.add(entry.id);
        renderCoachPRs();
      });
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

  function renderAthletePRs() {
    const container = $("#athlete-pr-container");
    const empty = $("#athlete-pr-empty");
    container.innerHTML = "";
    const prog = state.clientData.program; if (!prog) return;
    const athleteOwn = (state.clientData.progress.personalRecords || []).map((p) => ({ ...p, _author: "athlete" }));
    const coachPRs = (prog.client.coachPRs || []).filter(p => p.name);
    if (!athleteOwn.length && !coachPRs.length) { show(empty); return; }
    hide(empty);

    // Shared 1RM/2RM/3RM cards — same list the coach sees; either side can fill them in.
    const pushCoachPRs = () => {
      saveClient();
      if (window.Cloud?.enabled && prog.clientId) {
        window.Cloud.debounce(`coachprs:${prog.clientId}`,
          () => window.Cloud.updateAthleteCoachPRs(prog.clientId, prog.client.coachPRs), 1200);
      }
    };
    coachPRs.forEach(entry => {
      const card = document.createElement("div");
      card.className = "pr-edit-card pr-shared-card";
      card.innerHTML = `
        <div class="pr-view-header">
          <h4 class="pr-exercise-name">${escapeHtml(entry.name)}</h4>
        </div>
        <div class="pr-edit-fields">
          <div class="pr-field-group">
            <label class="pr-field-label">1 Rep PR (lb)</label>
            <input class="pr-1rm-input" type="number" min="0" step="any" placeholder="e.g. 315" value="${escapeHtml(entry.pr1 || "")}">
          </div>
          <div class="pr-field-group">
            <label class="pr-field-label">2 Rep PR (lb)</label>
            <input class="pr-2rm-input" type="number" min="0" step="any" placeholder="e.g. 295" value="${escapeHtml(entry.pr2 || "")}">
          </div>
          <div class="pr-field-group">
            <label class="pr-field-label">3 Rep PR (lb)</label>
            <input class="pr-3rm-input" type="number" min="0" step="any" placeholder="e.g. 275" value="${escapeHtml(entry.pr3 || "")}">
          </div>
        </div>`;
      card.querySelector(".pr-1rm-input").addEventListener("input", (e) => { entry.pr1 = e.target.value; pushCoachPRs(); });
      card.querySelector(".pr-2rm-input").addEventListener("input", (e) => { entry.pr2 = e.target.value; pushCoachPRs(); });
      card.querySelector(".pr-3rm-input").addEventListener("input", (e) => { entry.pr3 = e.target.value; pushCoachPRs(); });
      container.appendChild(card);
    });

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
    const suggestions = suggestExerciseNames(side);
    const datalistOpts = suggestions.map((n) => `<option value="${escapeHtml(n)}">`).join("");
    openModal({
      title: "Add a PR",
      body: `
        <label>Exercise
          <input type="text" id="pr-name" list="pr-name-list" placeholder="e.g. Back Squat" autofocus />
          <datalist id="pr-name-list">${datalistOpts}</datalist>
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
  function renderAthleteSessions() {
    const container = $("#athlete-session-container"); if (!container) return;
    container.innerHTML = "";
    const prog = state.clientData.program;
    if (!prog?.client) return;
    ensureSessionBank(prog.client);
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
    container.appendChild(balance);

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

    // Quick-buy package picker
    const buyCard = document.createElement("div");
    buyCard.className = "card";
    buyCard.innerHTML = `<h4 style="margin-top:0">Buy more sessions</h4>
      <p class="muted" style="font-size:0.85rem">Pre-pay pricing (10% off) — your coach gets a request and confirms after you settle payment with them outside the app.</p>
      <div class="pkg-size-grid">${packageOptionButtonsHtml()}</div>`;
    container.appendChild(buyCard);
    buyCard.querySelectorAll("[data-buy-size]").forEach((btn) => {
      btn.addEventListener("click", () => requestPackage(Number(btn.dataset.buySize)));
    });

    // Pending requests (athlete side)
    if (pending.length) {
      const reqCard = document.createElement("div");
      reqCard.className = "card";
      reqCard.innerHTML = `<h4 style="margin-top:0">Your pending requests</h4>
        <p class="muted" style="font-size:0.85rem">Your coach has been notified — they'll add the sessions once payment is settled.</p>`;
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

    // Redemption history (read-only view of coach's record)
    const redemptions = prog.client.sessionBank.redemptions || [];
    const redCard = document.createElement("div");
    redCard.className = "card";
    redCard.innerHTML = `<h4 style="margin-top:0">Recent sessions</h4>`;
    if (!redemptions.length) {
      redCard.insertAdjacentHTML("beforeend", `<p class="muted">No sessions logged yet. Your coach marks each session after it happens.</p>`);
    } else {
      [...redemptions].sort((a, b) => (b.date || "").localeCompare(a.date || "")).slice(0, 12).forEach((r) => {
        const row = document.createElement("div");
        row.className = "session-redeem-row";
        row.innerHTML = `<div><strong>${escapeHtml(r.date || "")}</strong>${r.note ? ` · <span class="muted">${escapeHtml(r.note)}</span>` : ""}</div>`;
        redCard.appendChild(row);
      });
    }
    container.appendChild(redCard);
  }

  function requestPackage(size) {
    const opt = PACKAGE_OPTIONS.find((o) => o.sessions === size);
    if (!opt) return;
    if (!state.clientData.progress.packageRequests) state.clientData.progress.packageRequests = [];
    state.clientData.progress.packageRequests.push({
      id: uid(), size, price: opt.price, requestedAt: Date.now(),
    });
    saveClient();
    renderAthleteSessions();
    toast(`Requested ${size} sessions ($${opt.price.toLocaleString()}).`);
  }

  function openAthleteRequestPackageModal() {
    openModal({
      title: "Buy more sessions",
      body: `
        <p class="muted" style="margin-top:-0.4em">Pre-pay pricing (10% off). Tapping a card sends a purchase request to your coach. The app doesn't process payment — pay your coach directly (Venmo, cash, etc.) and they'll mark it paid.</p>
        <div class="pkg-size-grid">${packageOptionButtonsHtml()}</div>`,
      actions: [{ label: "Close", className: "btn btn-ghost", onClick: closeModal }],
    });
    $("#modal-body").querySelectorAll("[data-buy-size]").forEach((btn) => {
      btn.addEventListener("click", () => {
        requestPackage(Number(btn.dataset.buySize));
        closeModal();
      });
    });
  }

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
  // Mirrors the pre-pay (10% off) private 1-on-1 pricing on
  // stonedragonstrengthtraining.com/memberships.html — update both together.
  const PACKAGE_OPTIONS = [
    { sessions: 4,  price: 400,  cadence: "1×/week" },
    { sessions: 8,  price: 725,  cadence: "2×/week" },
    { sessions: 12, price: 1020, cadence: "3×/week" },
    { sessions: 16, price: 1320, cadence: "4×/week" },
  ];
  const PACKAGE_SIZES = PACKAGE_OPTIONS.map((o) => o.sessions);
  function packageOptionButtonsHtml() {
    return PACKAGE_OPTIONS.map((o) => `
      <button class="pkg-size-btn" type="button" data-buy-size="${o.sessions}">
        <span class="pkg-size-num">${o.sessions}</span>
        <span class="pkg-size-lbl">sessions · ${o.cadence}</span>
        <span class="pkg-size-price">$${o.price.toLocaleString()}</span>
      </button>`).join("");
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
    container.appendChild(balance);

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
          saveTrainer();
          renderCoachSessions();
          closeModal();
          toast(`Added ${size}-session package ✓`);
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
          <input type="text" id="gift-note" placeholder="e.g. On the house — great work this month!" />
        </label>`,
      actions: [
        { label: "Cancel", className: "btn btn-ghost", onClick: closeModal },
        { label: "Gift sessions 🎁", className: "btn btn-primary", onClick: () => {
          const size = parseInt($("#gift-size-input").value, 10);
          if (!size || size < 1 || size > 50) { toast("Enter a number between 1 and 50"); return; }
          const note = $("#gift-note").value.trim();
          ensureSessionBank(c);
          c.sessionBank.packages.push({ id: uid(), size, status: "paid", gift: true, price: 0, addedAt: Date.now(), paidAt: Date.now(), note });
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
    localStorage.setItem(KEY_TRAINER, JSON.stringify(state.trainerData));
    if (window.Cloud?.enabled) {
      window.Cloud.debounce(`athlete:${c.id}`, () =>
        window.Cloud.upsertAthlete(c, state.trainerData.coachId)
      );
    }
    if (state.currentClientId === c.id) renderCoachSessions();
    if (!$("#view-packages").classList.contains("hidden")) renderPackagesView();
    updatePackagesNavBadge();
  }

  // -------- Packages tracker (all athletes) --------
  // A request is open until a package row references its id (approve = paid
  // row, decline = cancelled placeholder).
  function openRequestsFor(c) {
    ensureSessionBank(c);
    return (c.importedProgress?.packageRequests || [])
      .filter((req) => !c.sessionBank.packages.some((p) => p.requestId === req.id));
  }

  function updatePackagesNavBadge() {
    const badge = $("#packages-nav-badge");
    if (!badge) return;
    const count = (state.trainerData.clients || [])
      .reduce((n, c) => n + openRequestsFor(c).length, 0);
    badge.textContent = count > 9 ? "9+" : String(count);
    badge.classList.toggle("hidden", count === 0);
  }

  // Pull fresh progress (which carries package requests) for every athlete,
  // then re-render. Also runs once in the background at coach entry so the
  // nav badge is current without visiting the page.
  let _packagesRefreshing = false;
  async function refreshAllAthletePackages() {
    if (!window.Cloud?.enabled || _packagesRefreshing) return;
    const clients = state.trainerData.clients || [];
    if (!clients.length) return;
    _packagesRefreshing = true;
    const btn = $("#btn-packages-refresh");
    if (btn) { btn.disabled = true; btn.textContent = "Syncing…"; }
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
      if (btn) { btn.disabled = false; btn.textContent = "🔄 Refresh"; }
    }
    if (!$("#view-packages").classList.contains("hidden")) renderPackagesView();
    updatePackagesNavBadge();
  }

  function renderPackagesView() {
    const reqContainer = $("#packages-requests-container");
    const athContainer = $("#packages-athletes-container");
    if (!reqContainer || !athContainer) return;
    reqContainer.innerHTML = "";
    athContainer.innerHTML = "";
    const clients = [...(state.trainerData.clients || [])]
      .sort((a, b) => (a.name || "").localeCompare(b.name || ""));

    // --- Open purchase requests across all athletes ---
    const open = [];
    clients.forEach((c) => openRequestsFor(c).forEach((req) => open.push({ c, req })));
    if (open.length) {
      const card = document.createElement("div");
      card.className = "card";
      card.innerHTML = `<h4 style="margin-top:0">Purchase requests</h4>
        <p class="muted" style="font-size:0.85rem">Confirm payment outside the app (Venmo, cash, Stripe link), then approve.</p>`;
      open.sort((a, b) => (b.req.requestedAt || 0) - (a.req.requestedAt || 0));
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
      reqContainer.appendChild(card);
    }

    // --- Per-athlete balances ---
    const card = document.createElement("div");
    card.className = "card";
    card.innerHTML = `<h4 style="margin-top:0">Athlete balances</h4>`;
    if (!clients.length) {
      card.insertAdjacentHTML("beforeend", `<p class="muted">No athletes yet.</p>`);
    }
    clients.forEach((c) => {
      const sum = sessionBankSummary(c);
      const lastRed = [...c.sessionBank.redemptions].sort((a, b) => (b.date || "").localeCompare(a.date || ""))[0];
      const pendingCount = openRequestsFor(c).length;
      const row = document.createElement("div");
      row.className = "pkg-track-row";
      row.innerHTML = `
        <div class="pkg-track-info">
          <strong>${escapeHtml(c.name)}</strong>
          <span class="muted">${sum.granted} purchased · ${sum.used} used${lastRed ? ` · last session ${escapeHtml(lastRed.date)}` : ""}</span>
        </div>
        ${pendingCount ? `<span class="pkg-track-pending">${pendingCount} request${pendingCount > 1 ? "s" : ""}</span>` : ""}
        <span class="booked-balance-chip${sum.remaining <= 1 ? " low" : ""}">🎟 ${sum.remaining} left</span>
        <span class="dash-booked-arrow">›</span>`;
      row.addEventListener("click", () => { openClient(c.id); setTab("sessions"); });
      card.appendChild(row);
    });
    athContainer.appendChild(card);
  }

  // -------- Share / import --------
  function shareClient() {
    const c = currentClient(); if (!c) return;
    const payload = {
      kind: "tp-program", v: 2,
      clientId: c.id,
      trainerName: state.trainerData.trainer?.name || "",
      sharedAt: Date.now(),
      client: {
        id: c.id, name: c.name, age: c.age, heightIn: c.heightIn, weightLb: c.weightLb,
        goals: c.goals, weeks: c.weeks, schedule: c.schedule || {},
        coachPRs: c.coachPRs || [],
        sessionBank: c.sessionBank || { packages: [], redemptions: [] },
        nutrition: c.nutrition || { current: null, history: [] },
        archivedPrograms: c.archivedPrograms || [],
        inviteCode: c.inviteCode || "",
      },
    };
    const code = encodeData(payload);
    openModal({
      title: "Access code for " + c.name,
      body: `
        <p>Send this code to <strong>${escapeHtml(c.name)}</strong>. They paste it into the Athlete Portal on their own device.</p>
        <textarea class="code-textarea" id="share-code-output" readonly>${escapeHtml(code)}</textarea>
        <div class="code-actions">
          <button class="btn btn-primary" id="btn-copy-share">Copy code</button>
        </div>
        <p class="muted" style="margin-top:0.8em">Re-share any time you update the program or schedule. The athlete's logs are preserved on re-import.</p>`,
      actions: [{ label: "Close", className: "btn btn-ghost", onClick: closeModal }],
    });
    $("#btn-copy-share").addEventListener("click", async () => {
      try { await navigator.clipboard.writeText(code); toast("Code copied"); }
      catch { $("#share-code-output").select(); document.execCommand("copy"); toast("Code copied"); }
    });
  }

  function importProgressPrompt() {
    openModal({
      title: "Import athlete progress",
      body: `
        <p>Paste the progress code your athlete sent you.</p>
        <textarea class="code-textarea" id="import-code-input" placeholder="Paste long string here..."></textarea>
        <p id="import-progress-error" class="error hidden"></p>`,
      actions: [
        { label: "Cancel", className: "btn btn-ghost", onClick: closeModal },
        { label: "Import", className: "btn btn-primary", onClick: () => {
            const err = $("#import-progress-error");
            try {
              const obj = decodeData($("#import-code-input").value);
              if (obj.kind !== "tp-progress") throw new Error("Wrong code type — this looks like a program code, not a progress code.");
              const c = state.trainerData.clients.find((x) => x.id === obj.clientId);
              if (!c) throw new Error("This code belongs to a different athlete (id not found here).");
              c.importedProgress = { ...obj.progress, syncedAt: Date.now() };
              saveTrainer();
              closeModal();
              setTab("logs");
              renderClientLogs();
              renderCoachCalendar();
              renderCoachPRs();
              toast("Progress imported");
            } catch (e) {
              err.textContent = "Couldn't import: " + (e.message || "invalid code");
              err.classList.remove("hidden");
            }
          },
        },
      ],
    });
    setTimeout(() => $("#import-code-input")?.focus(), 50);
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
        goals: match.goals, weeks: match.weeks, schedule: match.schedule || {},
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
        goals: athlete.goals, weeks: athlete.weeks, schedule: athlete.schedule || {},
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
  function emptyProgress() { return { exerciseLogs: {}, bodyweightLog: [], feedback: "", dayCompletions: {}, personalRecords: [], packageRequests: [], dayNotes: {} }; }
  function ensureProgressShape(p) {
    if (!p.exerciseLogs) p.exerciseLogs = {};
    if (!p.bodyweightLog) p.bodyweightLog = [];
    if (p.feedback == null) p.feedback = "";
    if (!p.dayCompletions) p.dayCompletions = {};
    if (!p.personalRecords) p.personalRecords = [];
    if (!p.packageRequests) p.packageRequests = [];
    if (!p.dayNotes) p.dayNotes = {};
    if (!Array.isArray(p.cardioLogs)) p.cardioLogs = [];
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
            <span class="muted">${escapeHtml(log.date || "")}</span>
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
      if (existing) {
        Object.assign(existing, { type, minutes, intensity, date });
      } else {
        logs.push({ id: uid(), type, minutes, intensity, date });
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
  // Auto-marks a day complete on the calendar once every exercise in it is
  // locked in — the athlete shouldn't have to separately check it off.
  function autoSyncDayCompletion(day) {
    if (!day.exercises.length) return;
    const allDone = day.exercises.every((ex) => hasAnyLog(ex));
    if (allDone === isDayChecked(day.id)) return;
    ensureProgressShape(state.clientData.progress);
    state.clientData.progress.dayCompletions[day.id] = allDone ? [todayISO()] : [];
    saveClient();
    renderAthleteCalendar();
  }
  function findCompletedDayForDate(client, iso) {
    const dc = state.clientData.progress?.dayCompletions || {};
    for (const week of client.weeks) {
      for (const day of week.days) {
        if ((dc[day.id] || []).includes(iso)) return { week, day };
      }
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
    state.mode = "client";
    sessionStorage.setItem(KEY_SESSION, "client");
    hide($("#screen-login"));
    hide($("#screen-app"));
    show($("#screen-client"));
    if (!state.clientData.progress) state.clientData.progress = emptyProgress();
    ensureProgressShape(state.clientData.progress);
    const prog = state.clientData.program;
    $("#client-portal-name").textContent = prog.client.name;
    setClientTab("workouts");
    const now = new Date();
    state.athleteCal = { year: now.getFullYear(), month: now.getMonth() };
    renderAthleteCalendar();
    renderClientWorkouts();
    renderClientDiet();
    renderClientProgress();
    renderAthleteCardio();
    renderAthletePRs();
    renderAthleteSessions();
  }
  function exitClient() {
    state.mode = null;
    sessionStorage.removeItem(KEY_SESSION);
    _signOutOnLeave = false;
    if (window.Cloud?.enabled) window.Cloud.signOut();
    showLoginScreen("#login-role");
  }
  function setClientTab(name) {
    $$(".tab[data-ctab]").forEach((t) => t.classList.toggle("active", t.dataset.ctab === name));
    $$(".tab-panel[data-ctab-panel]").forEach((p) => p.classList.toggle("active", p.dataset.ctabPanel === name));
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
      if (completed) {
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
      const reds = redsByDate[iso] || [];
      if (reds.length) pillHtml += tokenPillHtml(reds);
      cell.innerHTML = `<div class="cal-date-num">${d.getDate()}</div>${pillHtml}`;
      // Athletes can only plan today/future days here — completion itself
      // is auto-detected from locked-in exercise logs, not hand-picked.
      if (inMonth && isUpcoming) {
        cell.addEventListener("click", () => openAthleteLogDayModal(iso));
      } else if (inMonth && reds.length) {
        // Past days aren't plannable, so a tap can surface the redemption
        // details instead (title tooltips don't exist on mobile).
        cell.classList.add("has-log");
        cell.addEventListener("click", () => openRedemptionDetailsModal(iso, reds));
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
    const fallback = $("#client-weeks-container");
    if (fallback) fallback.innerHTML = "";

    if (!prog?.client?.weeks?.length) {
      picker.querySelector(".workout-grid").innerHTML = "";
      picker.querySelector(".week-chips").innerHTML = "";
      const empty = `<div class="empty-state"><div class="empty-emoji">📋</div><h3>No weeks yet</h3><p>Your coach hasn't added any weeks to your program yet.</p></div>`;
      picker.querySelector(".workout-grid").innerHTML = empty;
      hide(detail); show(picker);
      return;
    }

    const jumpTo = state.__jumpTo;
    state.__jumpTo = null;

    // If a jump-to was set (from calendar click), prefer it.
    if (jumpTo?.weekId && jumpTo?.dayId) {
      state.workoutView = { mode: "detail", weekId: jumpTo.weekId, dayId: jumpTo.dayId, date: jumpTo.date || todayISO() };
    } else if (!state.workoutView.weekId) {
      state.workoutView.weekId = prog.client.weeks[0].id;
    } else if (!prog.client.weeks.some((w) => w.id === state.workoutView.weekId)) {
      // Stored week no longer exists (program edited) — fall back to first.
      state.workoutView.weekId = prog.client.weeks[0].id;
    }

    // Always populate the "See all weeks" fallback so legacy detail-in-list still works.
    prog.client.weeks.forEach((week, wIdx) => {
      const expand = wIdx === 0;
      fallback.appendChild(renderClientWeek(week, wIdx, expand, null));
    });

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

  // Clipboard only surfaces the first N weeks; deeper weeks live under "See all weeks".
  const CLIPBOARD_WEEK_LIMIT = 4;

  function renderWorkoutPickerUI() {
    const prog = state.clientData.program;
    if (!prog?.client?.weeks?.length) return;
    const chips = $("#workout-week-chips");
    const grid = $("#workout-day-grid");

    const clipboardWeeks = prog.client.weeks.slice(0, CLIPBOARD_WEEK_LIMIT);
    // Clamp the active week to the visible set so chips and day grid stay in sync.
    if (!clipboardWeeks.some((w) => w.id === state.workoutView.weekId)) {
      state.workoutView.weekId = clipboardWeeks[0]?.id || null;
    }

    // Streak / total logged count (across all exercises)
    const totalLogged = Object.values(state.clientData.progress?.exerciseLogs || {})
      .reduce((n, arr) => n + (Array.isArray(arr) ? arr.length : 0), 0);
    const streakEl = $("#streak-count");
    if (streakEl) streakEl.textContent = totalLogged;

    // Week chips
    chips.innerHTML = "";
    clipboardWeeks.forEach((week) => {
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
      const icon = day.icon || workoutIconFor(day.name);
      card.innerHTML = `
        <div class="workout-card-icon">${dayIconHtml(icon)}</div>
        <div class="workout-card-body">
          <h4 class="workout-card-title">${escapeHtml(day.name)}</h4>
          <div class="workout-card-meta">
            <span class="meta-pill">${totalEx} exercise${totalEx === 1 ? "" : "s"}</span>
            ${checked
              ? `<span class="meta-pill meta-done">Done ✓</span>`
              : doneEx > 0
                ? `<span class="meta-pill meta-progress">${doneEx} / ${totalEx} logged</span>`
                : `<span class="meta-pill meta-todo">Tap to start</span>`}
          </div>
        </div>
        <div class="workout-card-chevron">›</div>
      `;
      card.addEventListener("click", () => {
        state.workoutView = { mode: "detail", weekId: week.id, dayId: day.id, date: todayISO() };
        renderWorkoutDetailUI();
      });
      grid.appendChild(card);
    });
  }

  // Pick a fun emoji based on day name keywords. Pure UI flavor.
  function workoutIconFor(name) {
    const n = String(name || "").toLowerCase();
    if (/(squat|lower|leg|quad|hamstring)/.test(n)) return "🦵";
    if (/(deadlift|pull|back|row|lat)/.test(n)) return "🪝";
    if (/(push|chest|bench|press|shoulder|delt|tricep)/.test(n)) return "💪";
    if (/(bicep|arm|curl)/.test(n)) return "💪";
    if (/(core|abs|trunk)/.test(n)) return "🌀";
    if (/(cardio|condition|run|sprint|hiit)/.test(n)) return "🏃";
    if (/(rest|recovery|mobility|stretch)/.test(n)) return "🧘";
    return "🐉";
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

  function renderWorkoutDetailHeader(week, day) {
    if (!state.workoutView.date) state.workoutView.date = todayISO();
    const head = $("#workout-detail-head");
    const totalEx = day.exercises.length;
    const doneEx = day.exercises.filter((ex) => hasAnyLog(ex)).length;
    const checked = isDayChecked(day.id);
    head.innerHTML = `
      <div class="detail-head-top">
        ${week.phaseLabel ? `<span class="phase-badge">${escapeHtml(week.phaseLabel)}</span>` : ""}
        <span class="muted">${escapeHtml(week.label)}${week.focus ? " · " + escapeHtml(week.focus) : ""}</span>
      </div>
      <div class="detail-head-main">
        <button class="day-check-toggle ${checked ? "checked" : ""}" id="detail-toggle" aria-label="Mark whole day complete">${checked ? "✓" : ""}</button>
        <h2>${escapeHtml(day.name)}</h2>
        <input type="date" class="detail-log-date" id="detail-log-date" value="${escapeHtml(state.workoutView.date)}" title="Date these logs are for" />
      </div>
      <div class="detail-head-stats">
        <span class="meta-pill">${totalEx} exercise${totalEx === 1 ? "" : "s"}</span>
        ${doneEx > 0 ? `<span class="meta-pill meta-progress">${doneEx} / ${totalEx} logged</span>` : ""}
        ${checked ? `<span class="meta-pill meta-done">Day done ✓</span>` : ""}
      </div>
    `;
    head.querySelector("#detail-toggle").addEventListener("click", () => {
      toggleDayComplete(day.id);
      toast(checked ? "Unchecked" : "Day complete ✓");
      renderWorkoutDetailUI();
    });
    head.querySelector("#detail-log-date").addEventListener("change", (e) => {
      state.workoutView.date = e.target.value || todayISO();
      renderWorkoutDetailUI();
    });
  }

  function renderWorkoutDetailUI() {
    const prog = state.clientData.program;
    const week = prog?.client?.weeks?.find((w) => w.id === state.workoutView.weekId);
    const day = week?.days?.find((d) => d.id === state.workoutView.dayId);
    if (!week || !day) {
      // Day was removed; bail back to picker.
      state.workoutView = { mode: "picker", weekId: week?.id || null, dayId: null };
      hide($("#workout-detail")); show($("#workout-picker"));
      return;
    }

    renderWorkoutDetailHeader(week, day);

    const list = $("#workout-detail-list");
    list.innerHTML = "";
    if (!day.exercises.length) {
      list.innerHTML = `<div class="empty-state"><div class="empty-emoji">💤</div><p>No exercises for this day.</p></div>`;
    } else {
      day.exercises.forEach((ex) => list.appendChild(renderClientExercise(week, day, ex, null)));
    }
    list.appendChild(renderDayNoteBlock(day.id));

    hide($("#workout-picker"));
    show($("#workout-detail"));
    // Keep the picker grid count fresh in case user comes back.
    renderWorkoutPickerUI();
    // Scroll detail into view smoothly.
    setTimeout(() => $("#workout-detail")?.scrollIntoView({ behavior: "smooth", block: "start" }), 30);
  }

  function backToWorkoutPicker() {
    state.workoutView.mode = "picker";
    state.workoutView.dayId = null;
    renderWorkoutPickerUI();
    hide($("#workout-detail"));
    show($("#workout-picker"));
  }
  function renderClientWeek(week, wIdx, expand, jumpTo) {
    const card = document.createElement("div");
    card.className = "week-card";
    if (week.phaseLabel) card.classList.add("phase-card");
    if (expand) card.classList.add("open");
    const totalDays = week.days.length;
    const completedDays = week.days.filter((d) => isDayChecked(d.id)).length;
    const pct = totalDays ? Math.round((completedDays * 100) / totalDays) : 0;
    const weekComplete = completedDays === totalDays && totalDays > 0;
    const head = document.createElement("div");
    head.className = "week-head";
    head.innerHTML = `
      <div>
        <h4>${week.phaseLabel ? `<span class="phase-badge">${escapeHtml(week.phaseLabel)}</span>` : ""}${escapeHtml(week.label)}${week.focus ? " — " + escapeHtml(week.focus) : ""}</h4>
        <div class="week-info">${completedDays} / ${totalDays} day${totalDays === 1 ? "" : "s"} complete${weekComplete ? " · ✓ Week done" : ""}</div>
      </div>
      <div class="week-head-right"><span class="week-toggle">▾</span></div>`;
    head.addEventListener("click", () => card.classList.toggle("open"));
    const body = document.createElement("div");
    body.className = "week-body";
    const progress = document.createElement("div");
    progress.className = "week-progress" + (weekComplete ? " complete" : "");
    progress.innerHTML = `
      <div class="week-progress-label">${weekComplete ? "Week complete ✓" : `${completedDays} / ${totalDays} days`}</div>
      <div class="week-progress-track"><div class="week-progress-fill" style="width:${pct}%"></div></div>
      <div class="week-progress-pct">${pct}%</div>`;
    body.appendChild(progress);
    week.days.forEach((day) => body.appendChild(renderClientDay(week, day, jumpTo)));
    card.appendChild(head); card.appendChild(body);
    return card;
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
  function renderClientDay(week, day, jumpTo) {
    const card = document.createElement("div");
    card.className = "client-day-card";
    const totalEx = day.exercises.length;
    const doneEx = day.exercises.filter((ex) => hasAnyLog(ex)).length;
    const checked = isDayChecked(day.id);
    if (checked) card.classList.add("day-checked");
    card.innerHTML = `
      <div class="client-day-head">
        <div class="day-head-left-flex">
          <button class="day-check-toggle ${checked ? "checked" : ""}" data-action="toggle-day" type="button" aria-label="Mark day complete">${checked ? "✓" : ""}</button>
          <h4>${escapeHtml(day.name)}</h4>
        </div>
        <div class="day-head-stats">
          ${checked ? `<span class="day-complete-badge">Done ✓</span>` : ""}
          ${doneEx > 0
            ? `<span class="muted">${doneEx} / ${totalEx} logged</span>`
            : ""}
        </div>
      </div>`;
    card.querySelector('[data-action="toggle-day"]').addEventListener("click", () => {
      toggleDayComplete(day.id);
      toast(checked ? "Unchecked" : "Day complete ✓");
    });
    const exList = document.createElement("div");
    exList.className = "cex-list";
    day.exercises.forEach((ex) => exList.appendChild(renderClientExercise(week, day, ex, jumpTo)));
    card.appendChild(exList);
    return card;
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
  function renderClientExercise(week, day, ex, jumpTo) {
    if (!ex.modifiers) ex.modifiers = [];
    const logs = state.clientData.progress?.exerciseLogs?.[ex.id] || [];
    const isDone = hasAnyLog(ex);
    const lastLog = logs.length ? [...logs].sort((a, b) => b.date.localeCompare(a.date))[0] : null;

    const wrapper = document.createElement("div");
    wrapper.className = "cex-wrapper" + (isDone ? " logged" : "");
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
    if (ex.currentWeight) {
      const lo = ex.currentWeight === "BW" ? "BW" : ex.currentWeight + " lb";
      const hi = ex.goalWeight && ex.goalWeight !== ex.currentWeight
        ? (ex.goalWeight === "BW" ? "BW" : ex.goalWeight + " lb")
        : null;
      rxParts.push(hi ? lo + "–" + hi : lo);
    }
    if (ex.currentReps) rxParts.push("× " + ex.currentReps);
    const rxMain = document.createElement("span");
    rxMain.className = "cex-rx-main";
    rxMain.textContent = rxParts.join(" · ") || "—";
    rxEl.appendChild(rxMain);

    if (lastLog) {
      const ll = document.createElement("span");
      ll.className = "cex-last-log";
      if (lastLog.sets?.length) {
        const s = lastLog.sets[0];
        ll.textContent = `Last: ${s.weight ? s.weight + " lb" : "BW"} × ${s.reps || "?"} (${lastLog.sets.length} set${lastLog.sets.length === 1 ? "" : "s"})`;
      } else {
        ll.textContent = `Last: ${lastLog.weight ? lastLog.weight + " lb" : "BW"} × ${lastLog.reps || "?"}`;
      }
      rxEl.appendChild(ll);
    }

    content.appendChild(rxEl);
    row.appendChild(doneCircle);
    row.appendChild(content);

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
    if (ytId || ex.videoUrl) {
      const vBtn = document.createElement("button");
      vBtn.className = "btn btn-sm btn-ghost";
      vBtn.textContent = "▶ Watch demo";
      vBtn.addEventListener("click", (e) => {
        e.stopPropagation();
        if (ytId) openVideoModal(ytId, ex.name || "Exercise");
        else window.open(ex.videoUrl, "_blank", "noopener");
      });
      panel.appendChild(vBtn);
    }

    // Log form
    const logDate = state.workoutView?.dayId === day.id && state.workoutView?.date
      ? state.workoutView.date
      : (jumpTo?.dayId === day.id ? jumpTo.date : todayISO());
    const logForm = document.createElement("div");
    logForm.className = "cex-log-form";

    const numSets = parseInt(ex.sets) || 0;
    const wtPh = ex.currentWeight && ex.currentWeight !== "BW" ? ex.currentWeight : "";
    const repPh = ex.currentReps || "";

    // Header row
    const setTable = document.createElement("div");
    setTable.className = "cex-set-table";

    if (!numSets) {
      setTable.innerHTML = `<p class="cex-no-sets">Sets not prescribed yet — your coach will fill this in.</p>`;
      logForm.appendChild(setTable);
    } else {
    const todayLog = logs.find(l => l.date === logDate);
    let isLocked = isLogEntryLocked(todayLog, ex, numSets);

    const setInputs = [];
    for (let s = 0; s < numSets; s++) {
      const col = document.createElement("div");
      col.className = "cex-set-col";

      const lbl = document.createElement("span");
      lbl.className = "cex-set-lbl";
      lbl.textContent = `S${s + 1}`;

      const wt = Object.assign(document.createElement("input"), { type: "number", step: "0.5", min: "0", placeholder: wtPh || "lb", readOnly: isLocked });
      const rp = Object.assign(document.createElement("input"), { type: "number", min: "0", placeholder: repPh || "reps", readOnly: isLocked });
      [wt, rp].forEach((i) => { i.className = "cex-input"; i.addEventListener("click", (e) => e.stopPropagation()); });

      col.appendChild(lbl);
      col.appendChild(wt);
      col.appendChild(rp);
      setTable.appendChild(col);
      setInputs.push({ wt, rp });
    }

    // Pre-fill today's existing log so edits persist
    if (todayLog?.sets?.length) {
      todayLog.sets.forEach((s, i) => {
        if (setInputs[i]) { setInputs[i].wt.value = s.weight || ""; setInputs[i].rp.value = s.reps || ""; }
      });
    }

    // Finisher slots (burnout / dropset). Weight is the drop-to % of the
    // prescribed weight (computed, shown as a target); the athlete logs reps.
    const finisherInputs = []; // { kind, dropIdx, pct, target, rp }
    const finisherWrap = document.createElement("div");
    finisherWrap.className = "cex-finisher-wrap";
    const addFinisherSlot = (kind, dropIdx, label, pct) => {
      const target = finisherDropWeight(ex.currentWeight, pct);
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

    // Auto-save: debounced 800ms after last keystroke, saves a draft entry.
    // Drafts never lock in the green checkmark — only the Lock button does.
    let _ast = null;
    const autoSave = () => {
      clearTimeout(_ast);
      _ast = setTimeout(() => {
        const sets = setInputs.map(({ wt, rp }) => ({ weight: wt.value, reps: rp.value }))
                              .filter(s => s.weight || s.reps);
        if (!sets.length && !finisherHasData()) {
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
        const entry = { id: idx >= 0 ? exLogs[idx].id : uid(), date: logDate, sets, locked: false, ...collectFinishers() };
        if (idx >= 0) exLogs[idx] = entry; else exLogs.push(entry);
        saveClient();
        renderAthleteCalendar();
      }, 800);
    };
    setInputs.forEach(({ wt, rp }) => {
      wt.addEventListener("input", autoSave);
      rp.addEventListener("input", autoSave);
    });
    finisherInputs.forEach(({ rp }) => rp.addEventListener("input", autoSave));

    // Lock / Edit toggle — the checkmark only fills in once the athlete
    // explicitly locks a fully-filled-in set of sets.
    const lockRow = document.createElement("div");
    lockRow.className = "cex-lock-row";

    const lockBtn = document.createElement("button");
    lockBtn.type = "button";
    lockBtn.className = "btn btn-primary btn-sm cex-lock-btn";
    lockBtn.textContent = "🔒";
    lockBtn.title = "Lock in";

    const editBtn = document.createElement("button");
    editBtn.type = "button";
    editBtn.className = "cex-edit-btn";
    editBtn.textContent = "✎ Edit";

    const setFieldsReadonly = (readonly) => {
      setInputs.forEach(({ wt, rp }) => { wt.readOnly = readonly; rp.readOnly = readonly; });
      finisherInputs.forEach(({ rp }) => { rp.readOnly = readonly; });
    };
    const refreshLockUI = () => {
      hide(isLocked ? lockBtn : editBtn);
      show(isLocked ? editBtn : lockBtn);
      setFieldsReadonly(isLocked);
    };

    lockBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const sets = setInputs.map(({ wt, rp }) => ({ weight: wt.value, reps: rp.value }));
      const complete = sets.every((s) => s.reps && (s.weight || ex.currentWeight === "BW"));
      if (!complete) { toast("Fill in all sets before locking in."); return; }
      if (!finisherComplete()) { toast("Fill in your burnout/dropset reps before locking in."); return; }
      clearTimeout(_ast);
      if (!state.clientData.progress.exerciseLogs[ex.id])
        state.clientData.progress.exerciseLogs[ex.id] = [];
      const exLogs = state.clientData.progress.exerciseLogs[ex.id];
      const idx = exLogs.findIndex(l => l.date === logDate);
      const entry = { id: idx >= 0 ? exLogs[idx].id : uid(), date: logDate, sets, locked: true, ...collectFinishers() };
      if (idx >= 0) exLogs[idx] = entry; else exLogs.push(entry);
      saveClient();
      isLocked = true;
      refreshLockUI();
      doneCircle.classList.add("done"); doneCircle.textContent = "✓";
      wrapper.classList.add("logged");
      autoSyncDayCompletion(day);
      if (state.workoutView?.mode === "detail" && state.workoutView.dayId === day.id) {
        renderWorkoutDetailHeader(week, day);
      }
    });

    editBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      const exLogs = state.clientData.progress.exerciseLogs[ex.id];
      const entry = exLogs?.find(l => l.date === logDate);
      if (entry) entry.locked = false;
      saveClient();
      isLocked = false;
      refreshLockUI();
      doneCircle.classList.remove("done"); doneCircle.textContent = "";
      wrapper.classList.remove("logged");
      autoSyncDayCompletion(day);
      if (state.workoutView?.mode === "detail" && state.workoutView.dayId === day.id) {
        renderWorkoutDetailHeader(week, day);
      }
    });

    lockRow.appendChild(lockBtn);
    lockRow.appendChild(editBtn);
    refreshLockUI();

    logForm.appendChild(setTable);
    if (finisherInputs.length) logForm.appendChild(finisherWrap);
    logForm.appendChild(lockRow);
    } // end else (numSets > 0)
    panel.appendChild(logForm);

    // Previous logs (last 3)
    if (logs.length) {
      const hist = document.createElement("div");
      hist.className = "cex-hist";
      [...logs].sort((a, b) => b.date.localeCompare(a.date)).slice(0, 3).forEach((l) => {
        const item = document.createElement("div");
        item.className = "cex-hist-item";
        const setStr = l.sets?.length
          ? l.sets.map((s, i) => `<span class="cex-hist-set"><em>S${i+1}</em> ${escapeHtml(s.weight || "BW")} × ${escapeHtml(s.reps || "?")}</span>`).join("")
          : `<span class="cex-hist-set">${escapeHtml(l.weight || "BW")} lb × ${escapeHtml(l.reps || "?")} reps</span>`;
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
    return wrapper;
  }

  function getDayVideos(client, sched) {
    if (!sched || sched.rest) return [];
    const wd = findWeekDay(client, sched.weekId, sched.dayId);
    if (!wd) return [];
    return wd.day.exercises
      .map((ex) => ({ id: ex.id, name: ex.name || "(unnamed)", ytId: getYouTubeId(ex.videoUrl) }))
      .filter((x) => x.ytId);
  }

  function openDayVideoPicker(videos, dayLabelStr) {
    if (videos.length === 1) {
      openVideoModal(videos[0].ytId, videos[0].name);
      return;
    }
    const list = videos.map((v) =>
      `<button class="video-pick-btn" data-yt="${escapeHtml(v.ytId)}" data-name="${escapeHtml(v.name)}"><span class="video-pick-icon">▶</span>${escapeHtml(v.name)}</button>`
    ).join("");
    openModal({
      title: `Demos — ${dayLabelStr}`,
      body: `<p class="muted" style="margin-top:-0.4em">Pick an exercise to watch.</p><div class="video-pick-list">${list}</div>`,
      actions: [{ label: "Close", className: "btn btn-ghost", onClick: closeModal }],
    });
    document.querySelectorAll(".video-pick-btn").forEach((b) => {
      b.addEventListener("click", () => {
        openVideoModal(b.dataset.yt, b.dataset.name);
      });
    });
  }

  function openVideoModal(ytId, name) {
    openModal({
      title: name ? `Demo — ${name}` : "Exercise demo",
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
  function renderBwHistory() {
    const wrap = $("#bw-history");
    wrap.innerHTML = "";
    const log = state.clientData.progress.bodyweightLog || [];
    if (!log.length) { wrap.innerHTML = `<p class="muted">No weight entries yet.</p>`; return; }
    [...log].sort((a, b) => b.date.localeCompare(a.date)).forEach((b) => {
      const row = document.createElement("div");
      row.className = "bw-entry";
      row.innerHTML = `
        <span><span class="date">${escapeHtml(b.date)}</span> — <strong>${escapeHtml(b.weightLb)} lb</strong></span>
        <button class="delete-bw" data-id="${b.id}" title="Delete">×</button>`;
      row.querySelector(".delete-bw").addEventListener("click", () => {
        if (!window.confirm("Delete this entry?")) return;
        state.clientData.progress.bodyweightLog =
          state.clientData.progress.bodyweightLog.filter((x) => x.id !== b.id);
        saveClient();
        renderBwHistory();
      });
      wrap.appendChild(row);
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
  function installPossible() {
    return !!_deferredInstallPrompt || isIOS();
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
    toast("Open your browser menu and choose Install / Add to Home Screen");
  }
  function showIOSInstallInstructions() {
    openModal({
      title: "Add to Home Screen",
      body: `
        <p class="muted" style="margin-top:-0.3em">Install Stone Dragon so it opens like an app — and works offline.</p>
        <ol class="install-steps">
          <li>Tap the <strong>Share</strong> button — the square with an arrow pointing up, at the bottom of Safari.</li>
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

    $("#btn-logout").addEventListener("click", signOutTrainer);
    $("#btn-add-client").addEventListener("click", addClientPrompt);
    $("#btn-back").addEventListener("click", renderDashboard);
    $("#btn-header-back").addEventListener("click", renderDashboard);
    // Coach side-nav
    document.querySelectorAll('#coach-nav [data-coach-nav]').forEach((b) => {
      b.addEventListener("click", () => {
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
          _programEditorId = null;
          state.currentClientId = null;
          if (!state.dashCal) { const n = new Date(); state.dashCal = { year: n.getFullYear(), month: n.getMonth() }; }
          switchCoachView("overview");
          hideLibSidebar();
          renderDashboardCalendar();
        } else if (target === "packages") {
          _programEditorId = null;
          state.currentClientId = null;
          switchCoachView("packages");
          hideLibSidebar();
          renderPackagesView();
          refreshAllAthletePackages();
        } else {
          _programEditorId = null;
          renderDashboard();
        }
      });
    });

    // Program creator
    $("#btn-new-program")?.addEventListener("click", newProgram);
    $("#btn-new-program-empty")?.addEventListener("click", newProgram);
    $("#btn-back-to-programs")?.addEventListener("click", () => { _programEditorId = null; renderProgramsList(); });
    $("#btn-editor-add-week-empty")?.addEventListener("click", addWeek);
    // Day Library (reachable from the Programs page)
    $("#btn-programs-day-library")?.addEventListener("click", () => { _programEditorId = null; renderDayLibrary(); });
    $("#btn-programs-new-day")?.addEventListener("click", () => { _programEditorId = null; openTemplateEditor(null); });
    $("#btn-daylib-back")?.addEventListener("click", () => { _programEditorId = null; renderProgramsList(); });
    $("#btn-daylib-new")?.addEventListener("click", () => openTemplateEditor(null));
    $("#btn-daylib-new-empty")?.addEventListener("click", () => openTemplateEditor(null));
    $("#btn-daylib-recommended")?.addEventListener("click", openRecommendedTemplatesModal);
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
    $("#btn-load-program").addEventListener("click", openLoadProgramModal);
    $("#btn-load-program-empty").addEventListener("click", openLoadProgramModal);
    $("#btn-archive-program").addEventListener("click", archiveCurrentProgram);

    // Exercise library
    $("#btn-close-library").addEventListener("click", closeExLibrary);
    $("#ex-library-backdrop").addEventListener("click", closeExLibrary);
    $("#ex-library-search").addEventListener("input", (e) => renderExLibrary(e.target.value));
    $("#ex-lib-sb-search")?.addEventListener("input", (e) => renderSidebarLibrary(e.target.value));

    // Drum picker
    $("#btn-drum-confirm").addEventListener("click", confirmDrum);
    $("#btn-drum-cancel").addEventListener("click", cancelDrum);
    $("#btn-drum-cancel-2").addEventListener("click", cancelDrum);
    $("#drum-modal").addEventListener("click", (e) => { if (e.target === e.currentTarget) cancelDrum(); });
    $("#btn-athlete-add-pr").addEventListener("click", () => openAddPRModal("athlete"));
    $("#btn-add-package")?.addEventListener("click", openAddPackageModal);
    $("#btn-gift-session")?.addEventListener("click", openGiftSessionModal);
    $("#btn-redeem-session")?.addEventListener("click", openRedeemSessionModal);
    $("#btn-athlete-request-package")?.addEventListener("click", openAthleteRequestPackageModal);
    $("#btn-packages-refresh")?.addEventListener("click", refreshAllAthletePackages);
    prefillRememberedEmails();
    $("#btn-export-sessions")?.addEventListener("click", () => {
      const c = currentClient(); if (c) exportSessionHistory(c);
    });
    $("#btn-athlete-export-sessions")?.addEventListener("click", () => {
      const client = state.clientData.program?.client; if (client) exportSessionHistory(client);
    });
    $("#btn-regen-invite").addEventListener("click", regenerateInviteCode);
    $("#btn-copy-invite").addEventListener("click", copyInviteCode);

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
    $$(".tab[data-ctab]").forEach((t) => t.addEventListener("click", () => setClientTab(t.dataset.ctab)));

    $("#btn-client-logout").addEventListener("click", exitClient);
    $("#btn-back-to-picker")?.addEventListener("click", backToWorkoutPicker);
    $("#btn-log-bw").addEventListener("click", logBodyweight);
    $("#btn-add-cardio")?.addEventListener("click", () => openCardioModal());
    $("#client-feedback").addEventListener("input", () => {
      state.clientData.progress.feedback = $("#client-feedback").value;
      saveClient();
    });

    document.querySelectorAll("#modal [data-close]").forEach((el) =>
      el.addEventListener("click", closeModal)
    );

    bindProfileInputs();

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
            try {
              const fresh = await window.Cloud.getCoachByAuthUserId(userId);
              if (fresh) populateCoachFromCloud(fresh.coach, fresh.athletes);
            } catch (e) { console.warn("[Boot] Coach refresh failed, using cached data", e); }
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
