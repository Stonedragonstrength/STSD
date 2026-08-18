// Extracted from app.js — Phase 2 (Training) of the module extraction. See
// docs/superpowers/specs/2026-08-17-test-runner-and-module-extraction-design.md.
//
// Loaded as a classic script (no bundler ships yet), so instead of `export`
// it assigns onto the STSD namespace; src/training/stat-field.spec.js
// imports THIS file and reads the namespace, so the shipped code is the
// tested code.
//
// The stat pentagon's engine: scoring (a stimulus point per hard working
// set, deliberately not tonnage), the decay curves, the day signatures,
// and the absolute axis calibration. The APPLY half stays in app.js —
// syncStatField and syncHoard mutate progress and decide what to persist.
// The profile table (exercise-stats.js) is read through the window global
// at CALL time.
(function () {
  "use strict";

  // From the earlier training modules, which index.html loads first.
  const {
    exKey, exResolvedName, exIsTimed, isCarryName, libCatFor,
    effortLevel, bandOf, DEFAULT_TRAINING_LEVEL,
  } = globalThis.STSD.training;
  if (typeof exKey !== "function" || typeof libCatFor !== "function") {
    throw new Error("the earlier src/training modules must load before stat-field.js");
  }

  function customExerciseList() {
    return globalThis.STSD.app?.customExerciseList?.() || [];
  }
  function cardioLogsAll(progress) {
    return Array.isArray(progress?.cardioLogs) ? progress.cardioLogs : [];
  }

  function athleteOwnDays(progress) {
    return Array.isArray(progress?.athleteDays) ? progress.athleteDays : [];
  }
  // The pool every "sessions, not program" walker should look at.
  function sessionDays(client, progress) {
    return [...(client?.oneOffDays || []), ...athleteOwnDays(progress)];
  }

  // ============================================================
  // The stat field — STR / AGI / DEX / END / CON
  // ============================================================
  // A five-axis proximity field fed by the work the athlete actually logged.
  // The unit is a STIMULUS POINT and the reference is one hard working set,
  // deliberately NOT tonnage: setLb() scores zero for timed work, mobility and
  // bodyweight lifts, which is exactly the half of the pentagon AGI and DEX
  // exist to reward. Pounds belong to the Hoard; this is a different question,
  // and the app must never quote two different pound totals for one session.
  //
  // Three pure layers, in order. None of them writes state or touches the DOM:
  //   statProfileFor      — which shared vector an exercise reads as
  //   statVectorForEntry  — what ONE locked log entry is worth, raw
  //   statBucketForDate   — a whole day, deduped and capped
  //
  // See docs/superpowers/specs/2026-08-13-stat-pentagon-design.md.
  const STAT_KEYS = ["STR", "AGI", "DEX", "END", "CON"];
  function statZero() { return { STR: 0, AGI: 0, DEX: 0, END: 0, CON: 0 }; }

  // The vendored table (exercise-stats.js), read the same way as
  // EXERCISE_EQUIPMENT: an installed PWA can be running app.js against a cached
  // bundle that predates the file, so a missing table has to degrade to "score
  // nothing" rather than throw on every render.
  function statTable() {
    const t = window.EXERCISE_STATS;
    return t && typeof t === "object" ? t : {};
  }
  function statProfileByKey(key) {
    const profiles = statTable().profiles;
    const p = key && profiles ? profiles[key] : null;
    return p && typeof p === "object" ? p : null;
  }
  // The profile keys the ENGINE names by hand — these two plus "mobility" and
  // the table's own fallback[""]. Everything else in the table is data it is
  // free to rename; these are a contract with it, and tests/stat-scoring.test.js
  // fails if the shipped table drops one.
  const STAT_IMPULSE_PROFILE = { Plyometric: "plyo-jump", Ballistic: "ballistic" };
  const STAT_MOBILITY_PROFILE = "mobility";

  // Rep bands (spec 3.2). The pot of points per set is identical in every
  // band — only the SPLIT moves — so nothing ever pays more for chasing a rep
  // count. 26+ is Nathan's "over 25 reps counts as endurance" call.
  function statRepBand(reps) {
    if (!(reps > 0)) return "mid";   // no reading = the neutral middle
    if (reps <= 5) return "lo";
    if (reps <= 12) return "mid";
    if (reps <= 25) return "hi";
    return "vhi";
  }
  // How much of a profile's STR share is actually earned (spec 4.2). STR reads
  // the flames, because 315 lb is a max for one athlete and a warm-up for
  // another — a load number means nothing without a person attached to it, and
  // the 🔥 picker is already the coach's athlete-relative judgement.
  //
  // Whatever is NOT earned is redirected to CON, never discarded, so a coach
  // who never touches the picker loses no points: the work lands in Condition
  // instead, and STR becomes an axis earned by programming heavy work.
  const STAT_STR_HARD = 0.7;         // 🔥×3 is partial; 🔥×4 is the whole share
  function statStrGate(ex, reps) {
    const eff = ex && ex.effort;
    let g = eff === "max" ? 1 : eff === "hard" ? STAT_STR_HARD : 0;
    // Rep-count fallback, so STR never dies on an untagged day. Reps and flames
    // are NOT the same measurement — flames are exertion, reps are proximity to
    // maximal LOAD — and STR is the load reading, so a set of 1-5 counts as
    // near-max whatever the coach tagged. Nobody performs triples for
    // endurance. Callers pass 0 for timed work, which has no reps to read.
    if (reps >= 1 && reps <= 5) g = 1;
    return g;
  }
  // Every stat except STR. Reported reality (RIR) beats prescription (flames),
  // and UNSET IS 1.00 — the multiplicative identity. Treating an absent opinion
  // as "light" would quietly shrink the pentagon of nearly every program in the
  // app, since most prescribed exercises carry no effort tag at all.
  const STAT_EFFORT_MULT = { light: 0.85, moderate: 1, hard: 1.1, max: 1.15 };
  const STAT_CARDIO_MULT = { low: 0.85, moderate: 1, high: 1.15 };
  function statIntensityMult(ex, entry) {
    const r = parseInt(entry && entry.rir, 10);   // RIR_OPTS: 0 / 2 / 4+
    if (Number.isFinite(r)) return r <= 0 ? 1.15 : r <= 2 ? 1 : 0.85;
    return STAT_EFFORT_MULT[ex && ex.effort] || 1;
  }

  // Seconds out of a prescription or a logged rep field. Holds and carries
  // store a bare number of seconds; the builder also writes "45s" and "3 min",
  // and — for cardio and carries — distances and calories that are not
  // durations at all. Bare "m" is deliberately NOT minutes: _repsFor writes
  // "30 m" for a carry, meaning metres. Anything unreadable returns null so the
  // caller can fall back to "one ordinary set".
  function statSeconds(v) {
    const s = String(v == null ? "" : v).trim().toLowerCase();
    if (!s) return null;
    let m = s.match(/^(\d+):([0-5]\d)$/);
    if (m) return parseInt(m[1], 10) * 60 + parseInt(m[2], 10);
    m = s.match(/^([\d.]+)\s*(h|hr|hrs|hour|hours)$/);
    if (m) return Math.round(parseFloat(m[1]) * 3600);
    m = s.match(/^([\d.]+)\s*(min|mins|minute|minutes)$/);
    if (m) return Math.round(parseFloat(m[1]) * 60);
    m = s.match(/^([\d.]+)\s*(s|sec|secs|second|seconds)$/);
    if (m) return Math.round(parseFloat(m[1]));
    m = s.match(/^([\d.]+)$/);
    if (m) return Math.round(parseFloat(m[1]));
    return null;                                  // "400m", "15 cal", "40 ft"
  }
  // Reps out of a logged set, falling back to what was prescribed. A locked
  // entry always has reps, but a legacy one or a coach-side edit may not.
  function statReps(v, ex) {
    const n = parseInt(v, 10);
    if (Number.isFinite(n) && n > 0) return n;
    const rx = parseInt(ex && ex.currentReps, 10);
    return Number.isFinite(rx) && rx > 0 ? rx : 0;
  }
  // Seconds of timed work that equal one working set. Holds and carries sit at
  // 45s; sprint and cardio profiles carry their own `ref`, because at the hold
  // scale a 30-minute run would slam into the daily cap and every run in the
  // app would then read exactly the same.
  const STAT_TIMED_REF_SEC = 45;
  const STAT_TIMED_MIN = 0.25;       // a 5-second stretch is not a working set
  function statTimedRef(profile) {
    const r = Number(profile && profile.ref);
    return isFinite(r) && r > 0 ? r : STAT_TIMED_REF_SEC;
  }
  // The vector for one set, normalised to shares that sum to 1. Normalising by
  // the row's OWN total means the table can be written in whole points or in
  // fractions and the engine is right either way — and a row that sums wrong
  // still scores the right shape at the right size instead of silently scaling
  // one athlete. The fixed-total invariant is pinned by the table's own test.
  function statProfileVector(profile, timed, reps) {
    if (!profile) return null;
    if (timed || !profile.lo) return profile.v || null;
    return profile[statRepBand(reps)] || profile.v || null;
  }
  function statShare(vec) {
    const out = statZero();
    let total = 0;
    STAT_KEYS.forEach((k) => {
      const n = Number(vec && vec[k]) || 0;
      if (n > 0) { out[k] = n; total += n; }
    });
    if (!total) return null;
    STAT_KEYS.forEach((k) => { out[k] = out[k] / total; });
    return out;
  }

  // Which vector an exercise reads as (spec 3.3). First hit wins, and every
  // step exists because no single source knows the answer:
  //   1. ex.sp        — a preset stamped on a coach CUSTOM exercise, which
  //                     resolves to no library category at all on the athlete's
  //                     device, so nothing below it can classify one.
  //   2. Impulse tag  — coach intent beats the default. A speed-day deadlift is
  //                     Ballistic however the table files a deadlift.
  //   3. the table    — every library name, on both devices.
  //   4. the category — one row per library shelf.
  //   5. kind         — a coach-made hold with no category left is a stretch.
  //   6. the default  — an unknown name logged with weight and reps is
  //                     resistance work by overwhelming prior.
  //
  // Classified off exResolvedName, NEVER ex.name: an athlete swap keeps the
  // exercise id and changes the name, so scoring a swapped-in Box Jump as the
  // Back Squat it replaced is wrong at exactly the moment it matters.
  function statProfileFor(ex, progress) {
    if (!ex) return null;
    let p = statProfileByKey(ex.sp);
    if (p) return p;
    const impulse = (ex.modifiers || []).find((t) => STAT_IMPULSE_PROFILE[t]);
    if (impulse) {
      p = statProfileByKey(STAT_IMPULSE_PROFILE[impulse]);
      if (p) return p;
    }
    const t = statTable();
    const name = exResolvedName(ex, progress) || ex.name || "";
    p = statProfileByKey(t.byName ? t.byName[exKey(name)] : null);
    if (p) return p;
    const cat = libCatFor(name);
    if (cat) {
      p = statProfileByKey(t.fallback ? t.fallback[cat] : null);
      if (p) return p;
    }
    if (ex.kind === "mobility") {
      p = statProfileByKey(STAT_MOBILITY_PROFILE);
      if (p) return p;
    }
    return statProfileByKey(t.fallback ? t.fallback[""] : null);
  }

  // What ONE locked log entry is worth, raw and uncapped. The daily cap belongs
  // to statBucketForDate — baking it in here would leave a capped number that
  // deleting or editing one exercise could never unwind.
  function statVectorForEntry(ex, entry, progress) {
    const out = statZero();
    // Drafts score nothing. The 800 ms autosave writes locked:false entries
    // whose sets survive a truthiness filter on reps alone, so without this an
    // abandoned half-typed day moves the field while the Hoard reads zero.
    if (!ex || !entry || entry.locked !== true || entry.skipped === true) return out;
    const profile = statProfileFor(ex, progress);
    if (!profile) return out;
    // A carry or a hold has no reps to read: 3×45s would otherwise land in the
    // 26+ endurance band while the same carry at 10s read as strength. The
    // exercise's own shape overrides the table here, so a mislabelled row can
    // never resurrect that bug.
    const timed = profile.timed === true || exIsTimed(ex) || ex.kind === "mobility";
    const mult = statIntensityMult(ex, entry);
    const w = Number(profile.w);
    const setW = isFinite(w) && w > 0 ? w : 1;
    const ref = statTimedRef(profile);
    const rxSec = statSeconds(ex.currentReps);

    const add = (reps, sec) => {
      const share = statShare(statProfileVector(profile, timed, reps));
      if (!share) return;
      // Duration replaces the rep bands for timed work. An unknown duration is
      // one ordinary set rather than nothing — the athlete did the round. There
      // is no upper clamp on purpose: the daily cap is the ceiling, and a clamp
      // here would make a 10-minute treadmill piece and a 40-minute one equal.
      const dur = timed ? (sec > 0 ? Math.max(STAT_TIMED_MIN, sec / ref) : 1) : 1;
      const base = setW * dur;
      const gate = statStrGate(ex, timed ? 0 : reps);
      const held = share.STR * (1 - gate);   // redirected to CON, never lost
      out.STR += base * share.STR * gate;
      STAT_KEYS.forEach((k) => {
        if (k === "STR") return;
        out[k] += base * mult * (share[k] + (k === "CON" ? held : 0));
      });
    };

    // BOTH log shapes, permanently. isHoldName() covers all 30 Speed/Agility
    // drills and all 20 Mobility stretches, and that card wrote
    // `rounds:[true,false]` with no `sets` key at all for years of history.
    // Reading only entry.sets scores zero for every ladder drill, bound,
    // sprint, cone drill and stretch in the library — it kills AGI and DEX
    // outright. Each true round is one completed set at the prescribed seconds.
    if (Array.isArray(entry.rounds)) {
      entry.rounds.forEach((done) => { if (done) add(0, rxSec); });
    }
    (entry.sets || []).forEach((s) => {
      if (!s || s.skipped) return;
      if (!s.reps && !s.weight) return;          // an empty row is not a set
      add(statReps(s.reps, ex), timed ? (statSeconds(s.reps) || rxSec) : 0);
    });
    // entry.warmups is DELIBERATELY not read: warm-ups are preparation, and
    // counting them pays an athlete for padding the ramp (same rule as
    // logEntryLb). Do not "fix" this by adding them.
    if (entry.burnout) add(statReps(entry.burnout.reps, ex), rxSec);
    // A dropset is ONE set with drops in it, not three sets.
    if (Array.isArray(entry.dropset) && entry.dropset.length) {
      add(statReps(entry.dropset[0] && entry.dropset[0].reps, ex), rxSec);
    }
    return out;
  }

  // A cardio log is already self-describing — {type, minutes, intensity, date}
  // — so it needs no definition lookup, and it reads the same Cardio row of the
  // fallback table that a treadmill piece prescribed inside a program day
  // reads. Where the athlete taps must not decide the number.
  function statVectorForCardio(log) {
    const out = statZero();
    const min = Number(log && log.minutes) || 0;
    if (min <= 0) return out;
    const t = statTable();
    const profile = statProfileByKey(t.fallback ? t.fallback.Cardio : null);
    const share = statShare(profile && profile.v);
    if (!share) return out;
    const w = Number(profile.w);
    const base = (isFinite(w) && w > 0 ? w : 1) * ((min * 60) / statTimedRef(profile));
    const mult = STAT_CARDIO_MULT[String(log.intensity || "").toLowerCase()] || 1;
    // A cardio log carries no flames, so any STR share the row holds is
    // redirected to CON — the same rule as everywhere else, applied honestly.
    STAT_KEYS.forEach((k) => {
      if (k === "STR") return;
      out[k] = base * mult * (share[k] + (k === "CON" ? share.STR : 0));
    });
    return out;
  }

  // Per stat, per day: the first 10 points at full credit, the next 6 at half,
  // nothing beyond — 13 is the hard ceiling. A hard normal session lands around
  // 6-9 in its dominant stat and never touches it; 40 sets of curls resolves to
  // 13. This matches the volume literature, where per-session productive volume
  // flattens around ten hard sets and past that an athlete accumulates fatigue
  // rather than adaptation.
  const STAT_DAY_FULL = 10;
  const STAT_DAY_HALF = 6;
  function statCapDay(n) {
    if (!(n > 0)) return 0;
    if (n <= STAT_DAY_FULL) return n;
    return STAT_DAY_FULL + Math.min(STAT_DAY_HALF, n - STAT_DAY_FULL) / 2;
  }

  // One training date, summed and capped — the bucket that gets stored on
  // progress.statField.
  //
  // Duplicate entries are collapsed FIRST, and that is not a nicety: nothing
  // enforces one entry per (exId, date). merge_progress dedupes on entry ID,
  // and lockIn searches only the LOCAL array for a matching date, so a device
  // that has not yet seen another device's entry mints a fresh uid() and both
  // ids then survive the union forever. syncHoard is immune because its awards
  // are keyed exId:date and the second write overwrites the first; a plain sum
  // is not, and it would double that session permanently. This is Nathan's
  // live-session workflow — coach and athlete both logging — not a
  // hypothetical. Highest `m` wins, the same tiebreak mergeExerciseLogs uses.
  function statBucketForDate(client, progress, dateISO) {
    if (!dateISO) return {};
    const out = statZero();
    const byId = hoardExerciseIndex(client, progress);
    Object.entries((progress && progress.exerciseLogs) || {}).forEach(([exId, entries]) => {
      const ex = byId.get(exId);
      if (!ex || !Array.isArray(entries)) return;
      let best = null;
      entries.forEach((e) => {
        if (!e || e.date !== dateISO) return;
        if (!best || (Number(e.m) || 0) > (Number(best.m) || 0)) best = e;
      });
      if (!best) return;
      const v = statVectorForEntry(ex, best, progress);
      STAT_KEYS.forEach((k) => { out[k] += v[k]; });
    });
    cardioLogsAll(progress).forEach((l) => {
      if (!l || l.date !== dateISO) return;
      const v = statVectorForCardio(l);
      STAT_KEYS.forEach((k) => { out[k] += v[k]; });
    });
    // Absent keys are zero. Dropping them is what keeps statField near 8 KB
    // instead of growing five numbers per training day for a whole career.
    const bucket = {};
    STAT_KEYS.forEach((k) => {
      const n = Math.round(statCapDay(out[k]) * 10) / 10;
      if (n > 0) bucket[k] = n;
    });
    return bucket;
  }


  // -------- The stat field: the ledger and the decay read --------
  // Calendar days between two local YYYY-MM-DD strings. Noon-anchored so DST
  // can't skew it, and midnight-to-midnight so it does NOT flip at local noon
  // the way daysSince() does — daysSince compares Date.now() against noon of
  // the given day, so a 7-day-old session reads 6 before lunch and 7 after,
  // and every axis would visibly step down at lunchtime. Use this, not
  // daysSince(), for anything the stat field reads.
  function daysBetweenISO(from, to) {
    return Math.round((new Date(to + "T12:00:00") - new Date(from + "T12:00:00")) / 86400000);
  }
// The same clock as a whole number, so the decay walk can subtract integers
  // instead of parsing two dates per comparison. Not a micro-optimisation: the
  // peak walk compares every banked day against every sample, so a year of
  // training is ~68,000 comparisons, and at two Date constructions each it
  // measured 55 ms per athlete — a 22-athlete roster paint spent 1.2 seconds
  // on it. With this it is 5.7 ms. Noon-anchored exactly like daysBetweenISO,
  // so the two clocks can never disagree.
  function statDayIndex(iso) {
    return Math.round(new Date(iso + "T12:00:00").getTime() / 86400000);
  }

  // The five clocks. Each stat holds at full value through its grace window,
  // then halves every `half` days. The order is the detraining literature's,
  // not a guess: the aerobic engine goes first (plasma volume falls within
  // days), maximal strength survives a month off, and structure goes last
  // (atrophy needs ~3 weeks to be detectable). The 7 days Nathan had in mind
  // for strength is real but belongs to AGI — what an athlete feels at a week
  // off is loss of snap, not loss of a max.
  //
  // Because the clocks are read-side, retuning them reshapes every athlete's
  // field on their next open. The profile weights baked into a bucket do not.
  const STAT_DECAY = {
    STR: { grace: 14, half: 45 },
    AGI: { grace: 7,  half: 30 },
    DEX: { grace: 7,  half: 35 },
    END: { grace: 5,  half: 18 },
    CON: { grace: 21, half: 60 },
  };
  // Five half-lives past CON's grace is 321 days, by which point a bucket is
  // worth under 3% of what it was. A year is that rounded up, and it keeps the
  // peak covering a full training year. Dropping everything older is what stops
  // statField growing with career length.
  const STAT_HORIZON_DAYS = 365;
  // A day re-prices freely for three days — long enough for "the athlete logged
  // it, then the coach fixed the effort tag". After that only a change to the
  // LOGS themselves reopens it, so nobody can reshape an athlete's past
  // pentagon from the editor. Same reasoning as the Hoard's frozen award.
  const STAT_RESTAMP_DAYS = 3;
  // Nothing falls to zero. The floor is a fraction of the athlete's own peak
  // and it rises with training age, because a trained athlete keeps more of
  // what they built. It is deliberately substantial rather than a token: six
  // weeks into a torn ACL the field has to still read as a recognisable version
  // of their build, not a dot. A tuning knob — expect to move it once it has
  // been seen against the real roster.
  const STAT_FLOOR_BY_LEVEL = { beginner: 0.35, intermediate: 0.45, advanced: 0.55 };

  // Unset and unrecognised both resolve to the default, same rule as
  // levelBands() — unrecognised matters because a cloud pull can hand back a
  // value written by a newer build.
  function statFloorFrac(client) {
    return STAT_FLOOR_BY_LEVEL[client?.trainingLevel] ?? STAT_FLOOR_BY_LEVEL[DEFAULT_TRAINING_LEVEL];
  }
  function statDecayFactor(stat, age) {
    const d = STAT_DECAY[stat];
    if (!d || age <= d.grace) return 1;
    return Math.pow(0.5, (age - d.grace) / d.half);
  }
  // Decay is a pure function of (stat, whole days) and the walk asks for the
  // same few hundred answers over and over, so they are computed once for the
  // whole horizon and then read. Lazy because STAT_DECAY is a tuning knob and
  // this must pick up an edit to it, not a value captured at load.
  let _statDecayTable = null;
  function statDecayTable() {
    if (!_statDecayTable) {
      _statDecayTable = {};
      STAT_KEYS.forEach((k) => {
        const col = new Array(STAT_HORIZON_DAYS + 1);
        for (let d = 0; d <= STAT_HORIZON_DAYS; d++) col[d] = statDecayFactor(k, d);
        _statDecayTable[k] = col;
      });
    }
    return _statDecayTable;
  }

  // djb2, the same hash athleteColorIdx uses, base36 so a day's fingerprint is
  // ~7 characters and cheap enough to store on every bucket. A collision costs
  // one day a refresh it didn't get; nothing about correctness runs through it.
  function statHash(s) {
    let h = 5381;
    for (let i = 0; i < s.length; i++) h = ((h << 5) + h + s.charCodeAt(i)) | 0;
    return Math.abs(h).toString(36);
  }

  // What the athlete logged on each date, fingerprinted, so a rebuild only
  // touches the days that actually moved. Every log writer stamps
  // m = Date.now() (autoSave, lockIn, doSkipExercise and the hold card all do),
  // so m alone catches any edit to a set. Cardio rows are the exception — they
  // are edited in place with the same id, so those have to be read by value.
  //
  // Drafts are fingerprinted too even though they score nothing: a superset is
  // always safe here, and it means the day re-prices the moment it locks.
  // Parts are sorted because a cloud merge can reorder both maps, and a
  // reordered day is not a changed day.
  function statDaySignatures(progress) {
    const parts = new Map();
    const add = (date, s) => {
      if (!date) return;
      const list = parts.get(date) || [];
      list.push(s);
      parts.set(date, list);
    };
    const logs = progress?.exerciseLogs || {};
    Object.keys(logs).forEach((exId) => {
      const entries = logs[exId];
      if (!Array.isArray(entries)) return;
      entries.forEach((e) => {
        if (!e || !e.date) return;
        add(e.date, `${exId}:${e.id || ""}:${Number(e.m) || 0}:${e.locked === true ? 1 : 0}`);
      });
    });
    (progress?.cardioLogs || []).forEach((l) => {
      if (!l || !l.date) return;
      add(l.date, `c:${l.id || ""}:${l.type || ""}:${Number(l.minutes) || 0}:${l.intensity || ""}`);
    });
    const out = new Map();
    parts.forEach((list, date) => out.set(date, statHash(list.sort().join("|"))));
    return out;
  }

  // Stat values only. The fingerprint rides along on the bucket, but a changed
  // fingerprint with identical numbers is not worth a localStorage write and a
  // cloud push. Values are stored to 1dp, so the epsilon is float noise only.
  function statBucketSame(a, b) {
    if (!a || !b) return false;
    return STAT_KEYS.every((k) => Math.abs((Number(a[k]) || 0) - (Number(b[k]) || 0)) < 0.05);
  }
  // A bucket as stored: one decimal, zeroes left out (absent keys read as zero),
  // plus the fingerprint of the logs it was priced from.
  function statBucketToStore(v, sig) {
    const out = {};
    STAT_KEYS.forEach((k) => {
      const n = Math.round((Number(v && v[k]) || 0) * 10) / 10;
      if (n) out[k] = n;
    });
    out.h = sig;
    return out;
  }

  // Banks one bucket per training date, holding that day's capped charge per
  // stat. Same shape as syncHoard: recompute only what is dirty, and hand the
  // caller a boolean so ONE saveClient covers the whole pass — this runs from
  // render paths and must not write on every draw.
  //
  // The first call on an athlete with history IS the backfill (spec §8): every
  // date is unknown, so every in-horizon date gets priced once.

  // Every exercise the athlete can have logged against, by log id. Walks the
  // program, the sessions outside it (coach one-offs + the athlete's own) and
  // anything they added themselves, so a lift is still priceable while it exists.
  function hoardExerciseIndex(client, progress) {
    const byId = new Map();
    const add = (ex) => { if (ex && ex.id) byId.set(ex.id, ex); };
    [...(client?.weeks || []), { days: sessionDays(client, progress) }]
      .forEach((w) => (w.days || []).forEach((d) => (d.exercises || []).forEach(add)));
    Object.values(progress?.addedExercises || {}).forEach((list) =>
      (Array.isArray(list) ? list : []).forEach(add));
    return byId;
  }

  // What "full" means on each axis, in stimulus points, on an ABSOLUTE scale
  // shared by every athlete. A beginner's field is genuinely small, because
  // size is progression: a normalised field would draw a novice and a
  // national-level lifter identically, which throws away the only thing the
  // picture is for.
  //
  // Derived rather than guessed, so it can be redone instead of rediscovered:
  // a stat held at a steady weekly earn E settles at about
  //     E * (grace + halflife / ln2) / 7
  // points, that being the area under its own decay curve. The retention
  // windows work out at STR 79d, AGI 50d, DEX 58d, END 31d, CON 108d, and the
  // weekly earns below are an athlete training that quality hard and
  // consistently: STR 20, AGI 10, DEX 10, END 15, CON 30 points a week. CON is
  // the largest because every set feeds it and nothing else does that.
  //
  // These are READ-side, so retuning them reshapes the whole roster at once
  // (spec 5.4). Calibrate against real athletes BEFORE this goes near one,
  // then leave them alone.
  // CALIBRATED 2026-08-14 against real production data — the first numbers here
  // were simulated, and they were 3-6x too high on every axis. Measured across
  // the four athletes who had opened their Progress tab (21 sessions, 77
  // athlete-days), the whole roster read 1-8% of full. The pentagon was a dot.
  //
  // Full is defined as the PLATEAU of a committed athlete: someone banking the
  // best value we have actually observed for that axis, every session, at the
  // roster's real frequency of 1.9 sessions a week, sustained. That plateau is a
  // true asymptote — identical at 400 and 800 simulated days — because decay
  // eventually balances accrual. Which is the property worth having: the field
  // measures how hard and how often someone trains, not how long they have been
  // on the books, so nobody creeps to full by merely existing.
  //
  // Against these numbers a typical athlete at the same frequency settles around
  // STR 46% / CON 60% / DEX 32% / END 11%, and today's roster (three weeks in,
  // still climbing toward their own plateau) reads 3-19%.
  //
  // AGI IS NOT CALIBRATED. It is zero for every athlete on the roster and always
  // has been — nothing currently programmed banks it, since the ⚡ builder does
  // not write Speed/Agility or plyometrics. Its value here only keeps the
  // designed ratio to DEX so that the first agility work Nathan programs moves
  // the axis visibly. Re-measure it the moment any athlete has AGI at all.
  // END RE-MEASURED 2026-08-15: 35 -> 160. The 08-14 sample was four athletes
  // and NOT ONE OF THEM HAD EVER LOGGED CARDIO — production confirms Cheryl Ray
  // is the only athlete on the roster with a single cardio entry. So END's
  // "best observed" of 4.8/day was the best day among people who do not train
  // endurance: 26+ rep gym work only, roster max 1.6/day. Every other axis was
  // measured on athletes doing the thing that feeds it; END was not.
  //
  // What that missed: cardio is END's primary input and scores 0.16/min
  // (cardio-steady, 8/10 share, 300 s ref), so ONE 20-minute walk banks 3.2 —
  // double the best gym day the constant was built from. It also breaks the
  // per-SESSION frequency the model assumes: gym work is capped at ~1.9 days a
  // week by recovery, cardio is not, and Cheryl banks END on 5.5 days a week.
  // Inside END's 5-day grace those buckets barely decay before the next lands,
  // so the two errors compound. She reached 112% of full and pegged the axis.
  //
  // 160 is the plateau of 45 min of moderate cardio 5 days a week (163,
  // rounded). It also puts END back in family on sessions-to-full, which is the
  // tell that 35 was wrong: STR 19, DEX 15, END 3.6 at the old number and 17 at
  // this one. Against it Cheryl reads 24% today and 45% if she sustains her
  // current habit; nobody else on the roster clears 2%, which is honest — they
  // do no conditioning at all, and that is a thing for the coach to see.
  //
  // CON RAISED 2026-08-15: 330 -> 550, found by the same projection that
  // confirmed END. The roster reads CON 12-35% today ONLY because it is three
  // weeks old; project each athlete's current habit to its plateau and four of
  // them go through the ceiling — Cheryl 541, Jeff 401, Alyssa 384, Kristyn
  // 380. CON is also the only axis where athletes already hit the 13/day cap,
  // which is the same "this axis is bigger than its container" signal END gave.
  //
  // 550 is the plateau of a capped day at ~2.7 a week, and it is the number
  // rather than 500 because 500 still pegs Cheryl at 108% — the point of the
  // exercise is headroom, and a constant that pegs the most consistent athlete
  // on the roster has none. At 550 she reads 98% and everyone else 57-73%.
  //
  // CON sits higher on sessions-to-full (50 days) than STR/DEX/END (19/15/17)
  // and that is correct, not drift: CON banks on EVERY training day including
  // cardio-only ones, and its 60-day half-life is the longest of the five, so
  // it accrues on more days and sheds them more slowly. The family check is
  // only meaningful between axes banked at similar frequency.
  //
  // AGI IS NOT CALIBRATED, still — and it is the same failure mode as END's,
  // caught one step earlier: nothing programmed banks it, so there is nothing
  // to measure yet. Re-measure it the moment any athlete has AGI at all.
  const STAT_FULL = { STR: 115, AGI: 20, DEX: 22, END: 160, CON: 550 };

  // Raw decayed points -> 0..1 of a full axis. Clamped at the top: an outlier
  // pegs the axis rather than blowing through the grid, and the constants are
  // chosen with headroom so that is rare.
  function statAxisFrac(key, v) {
    const full = STAT_FULL[key] || 1;
    const f = (Number(v) || 0) / full;
    return f <= 0 ? 0 : f >= 1 ? 1 : f;
  }
  const NS = (globalThis.STSD = globalThis.STSD || {});
  NS.training = Object.assign(NS.training || {}, {
    cardioLogsAll, athleteOwnDays, sessionDays, hoardExerciseIndex,
    STAT_KEYS, statZero, statTable, statProfileByKey,
    STAT_IMPULSE_PROFILE, STAT_MOBILITY_PROFILE, statRepBand,
    STAT_STR_HARD, statStrGate, STAT_EFFORT_MULT, STAT_CARDIO_MULT,
    statIntensityMult, statSeconds, statReps,
    STAT_TIMED_REF_SEC, STAT_TIMED_MIN, statTimedRef,
    statProfileVector, statShare, statProfileFor,
    statVectorForEntry, statVectorForCardio,
    STAT_DAY_FULL, STAT_DAY_HALF, statCapDay, statBucketForDate,
    statDayIndex, STAT_DECAY, STAT_HORIZON_DAYS, STAT_RESTAMP_DAYS,
    STAT_FLOOR_BY_LEVEL, statFloorFrac, statDecayFactor, statDecayTable,
    statHash, statDaySignatures, statBucketSame, statBucketToStore,
    daysBetweenISO,
    STAT_FULL, statAxisFrac,
  });
})();
