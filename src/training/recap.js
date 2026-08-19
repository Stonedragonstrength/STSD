// Program Recap (2026-08-18): the week-by-day completion model behind the
// roster drawer's matrix, the day popup and the recap sheet. Pure derivation,
// no DOM — app.js renders what this returns.
//
// Loaded as a classic script (no bundler ships yet), so instead of `export`
// it assigns onto the STSD namespace; src/training/recap.spec.js imports THIS
// file and reads the namespace, so the shipped code is the tested code.
//
// Two contracts the UI leans on:
// - "done" comes from dayCompletions ONLY, so the recap's N/M is the same
//   number the roster row's % already shows. Locked logs without a completion
//   read as partial, never done.
// - Lock semantics are NOT re-implemented here. They come from the app's own
//   checker through the STSD.app seam at call time (legacy no-flag entries
//   included), so "locked" here can never drift from what the rep sheet locks.
(function () {
  "use strict";

  // Read at call time, never captured: STSD.app is assigned when app.js boots,
  // which is after this file loads.
  function lockedFn() {
    const f = globalThis.STSD.app?.isLogEntryLocked;
    if (typeof f !== "function") {
      throw new Error("STSD.app.isLogEntryLocked missing — app.js must publish it on the seam");
    }
    return f;
  }

  // Work an entry actually carries. A bare quick-note tag is a record, not
  // work — same line athleteCurrentDay draws.
  function entryHasData(l) {
    if (!l) return false;
    if (Array.isArray(l.sets) && l.sets.some((s) => s && (s.weight || s.reps))) return true;
    if (Array.isArray(l.rounds) && l.rounds.some(Boolean)) return true;
    return !!(l.weight || l.reps);
  }

  const maxISO = (a, b) => (!a ? b : !b ? a : a > b ? a : b);

  // One bucket per exercise: locked > typed > skipped > none.
  function exerciseBucket(ex, entries, isLocked) {
    const numSets = parseInt(ex.sets) || 0;
    let bucket = "none";
    let date = null;
    for (const l of entries) {
      if (!l) continue;
      if (isLocked(l, ex, numSets)) {
        bucket = "locked";
        date = maxISO(date, l.date || null);
      } else if (!l.skipped && entryHasData(l)) {
        if (bucket !== "locked") bucket = "typed";
        date = maxISO(date, l.date || null);
      } else if (l.skipped) {
        if (bucket === "none") bucket = "skipped";
        date = maxISO(date, l.date || null);
      }
    }
    return { bucket, date };
  }

  // The whole program, week by week, day by day.
  // weeks: program order; progress: the athlete's (coach side: importedProgress);
  // currentDayId: athleteCurrentDay(c)?.dayId — decides next vs missed.
  function recapModel(weeks, progress, currentDayId) {
    const isLocked = lockedFn();
    const dc = progress?.dayCompletions || {};
    const logs = progress?.exerciseLogs || {};

    const flat = [];
    (weeks || []).forEach((w) => (w.days || []).forEach((d) => flat.push(d.id)));
    const curIdx = currentDayId ? flat.indexOf(currentDayId) : -1;

    let doneDays = 0;
    let lastTrained = null;
    let maxSlots = 0;
    let idx = -1;

    const outWeeks = (weeks || []).map((w) => {
      const days = (w.days || []).map((d) => {
        idx++;
        const comps = (Array.isArray(dc[d.id]) ? dc[d.id] : []).filter(Boolean);
        let locked = 0, typed = 0, skipped = 0;
        let workDate = null;
        (d.exercises || []).forEach((ex) => {
          const { bucket, date } = exerciseBucket(ex, logs[ex.id] || [], isLocked);
          if (bucket === "locked") { locked++; lastTrained = maxISO(lastTrained, date); }
          else if (bucket === "typed") typed++;
          else if (bucket === "skipped") skipped++;
          if (bucket !== "none") workDate = maxISO(workDate, date);
        });

        let state, date = null;
        if (comps.length) {
          state = "done";
          date = comps.reduce((m, x) => maxISO(m, x), null);
          doneDays++;
          lastTrained = maxISO(lastTrained, date);
        } else if (locked + typed > 0) {
          state = "partial";
          date = workDate;
        } else if (skipped > 0) {
          state = "skipped";
          date = workDate;
        } else if (d.id === currentDayId) {
          state = "next";
        } else if (curIdx >= 0 && idx < curIdx) {
          state = "missed";
        } else {
          state = "upcoming";
        }
        return { id: d.id, name: d.name || "", state, date, locked, typed, skipped,
                 total: (d.exercises || []).length };
      });
      maxSlots = Math.max(maxSlots, days.length);
      return {
        id: w.id, label: w.label || "", phaseLabel: w.phaseLabel || "",
        done: days.filter((d) => d.state === "done").length,
        total: days.length,
        days,
      };
    });

    return { totalDays: flat.length, doneDays, lastTrained, maxSlots, weeks: outWeeks };
  }

  // What the day popup / sheet prints for one exercise: the NEWEST entry that
  // carries data (or a skip), flagged with that entry's own state — so a draft
  // typed after a locked session shows the newest numbers, marked as typed.
  function recapExerciseDisplay(ex, progress) {
    const isLocked = lockedFn();
    const entries = (progress?.exerciseLogs?.[ex.id] || [])
      .filter((l) => l && (entryHasData(l) || l.skipped));
    if (!entries.length) return { kind: "none", date: null, sets: null, rounds: null };
    const l = entries.reduce((best, x) =>
      String(x.date || "") >= String(best.date || "") ? x : best);
    const numSets = parseInt(ex.sets) || 0;
    const kind = isLocked(l, ex, numSets) ? "locked" : l.skipped ? "skipped" : "typed";
    let sets = null, rounds = null;
    if (Array.isArray(l.rounds) && l.rounds.length) {
      rounds = { done: l.rounds.filter(Boolean).length, total: l.rounds.length };
    } else if (Array.isArray(l.sets) && l.sets.length) {
      sets = l.sets.filter((s) => s && (s.weight || s.reps))
        .map((s) => ({ weight: s.weight, reps: s.reps }));
    } else if (l.weight || l.reps) {
      sets = [{ weight: l.weight, reps: l.reps }];
    }
    return { kind, date: l.date || null, sets, rounds };
  }

  // Sessions outside the program (one-offs, the athlete's own days) for the
  // sheet's tail line. A day counts once a session happened there: any
  // exercise holds an entry not explicitly unlocked (legacy no-flag entries
  // count, drafts saved with locked:false do not), or the day has a
  // completion. Looser than the one-off card's "logged ✓" on purpose — that
  // badge means finished, this line means happened.
  function recapExtraSessions(days, progress) {
    if (!progress) return 0;
    const dc = progress.dayCompletions || {};
    const logs = progress.exerciseLogs || {};
    return (days || []).filter((day) =>
      (Array.isArray(dc[day.id]) ? dc[day.id] : []).length > 0 ||
      (day.exercises || []).some((ex) => (logs[ex.id] || []).some((l) => l && l.locked !== false))
    ).length;
  }

  const NS = (globalThis.STSD = globalThis.STSD || {});
  NS.training = Object.assign(NS.training || {}, {
    recapModel, recapExerciseDisplay, recapExtraSessions,
  });
})();
