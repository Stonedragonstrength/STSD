// Extracted from app.js — Phase 2 (Training) of the module extraction. See
// docs/superpowers/specs/2026-08-17-test-runner-and-module-extraction-design.md.
//
// Loaded as a classic script (no bundler ships yet), so instead of `export`
// it assigns onto the STSD namespace; src/training/readiness.spec.js imports
// THIS file and reads the namespace, so the shipped code is the tested code.
//
// The pre-workout readiness check-in's pure half: the question tables and
// the scoring. The writer (setDayReadiness) and the chip renderer stay in
// app.js — one saves state, the other builds HTML. What moves is the part
// with a permanent data obligation: TWO SCALES LIVE IN THE DATA FOREVER
// (see readinessAnswer below), and every reader must go through the remap.
(function () {
  "use strict";

  // -------- Pre-workout readiness check-in --------
  // Four taps before the first set: sleep, soreness, stress (four faces each,
  // summing to a 3-12 score) and a hungover side-axis that stays out of the
  // sum (see READINESS_FLAG).
  //
  // The effect on the progression ladder is deliberately ONE WAY: a low score
  // can only protect (a miss on a wrecked day stops counting as a stall), never
  // penalise, and a high score does nothing at all. Same reasoning as RIR only
  // ever accelerating - an answer has to be safe to give honestly, or nobody
  // gives it honestly. RIR already owns the accelerator; this owns the brake.
  // `ask` is what the athlete is answering; `label` is the same thing as a
  // noun, for the answered summary ("Soreness: A bit"). They are separate
  // because a question reads wrong in a summary and a noun reads wrong as a
  // prompt — "Soreness" over three buttons reading Wrecked / Some / Fresh left
  // "Some" meaning nothing at all.
  const READINESS_QS = [
    // Soreness and stress deliberately share one scale: the question above the
    // row is what they answer, so the buttons stay short and the block compact.
    // Four steps since 2026-08-11 (Nathan wanted a "somewhat positive" between
    // the middle and the top; he picked the faces layout from a rendered
    // side-by-side). The words no longer appear on the asking buttons — the
    // faces are the buttons — but they still carry the answered summary, the
    // chip titles and the coach's read.
    { id: "sleep",  icon: "😴", label: "Sleep",    ask: "How did you sleep?",    opts: ["Badly", "Okay", "Good", "Great"] },
    { id: "sore",   icon: "💪", label: "Soreness", ask: "How sore are you?",     opts: ["Very", "A bit", "Barely", "Not at all"] },
    { id: "stress", icon: "🧠", label: "Stress",   ask: "How stressed are you?", opts: ["Very", "A bit", "Barely", "Not at all"] },
  ];
  // One face per step, worst to best, shared by all three questions — the
  // face is how that axis FEELS, so one scale reads the same on every row.
  const READINESS_FACES = ["😖", "🙂", "😄", "🤩"];
  // The fourth row is a SIDE AXIS, not a fourth scale in the sum: three faces
  // (sick / kind of sick / good), kept out of the 3-12 score on purpose — a
  // differently-sized answer in the sum would shift every threshold and
  // reclassify years of saved check-ins. Its worst step protects the day
  // directly, same brake as a low score. Rides the record as `hungover: 1-3`
  // (worst → best). Legacy records simply don't have it — unknown is not
  // "No", so nothing is shown for them.
  const READINESS_FLAG = {
    id: "hungover", icon: "🍺", label: "Hungover", ask: "Hungover?",
    opts: ["Very", "A bit", "No"], faces: ["🤢", "🥴", "😄"],
  };
  // ---- Two scales live in the data forever. ----
  // Records written before the fourth step exist store 1-3 with 3 meaning the
  // TOP answer; new records store 1-4 and stamp `v: 2`. Cached builds keep
  // writing the old shape for weeks (see stsd-old-clients-read-old-fields), so
  // this is a permanent read-time remap, not a one-time migration: only the
  // top of the old scale moved (3 → 4). Badly/Okay kept their values, which
  // keeps the neutral score at 6 and READY_LOW_MAX honest on both scales.
  function readinessAnswer(rec, qid) {
    const v = parseInt(rec?.[qid], 10) || 0;
    if (!v) return 0;
    if ((parseInt(rec.v, 10) || 1) >= 2) return v;
    return v === 3 ? 4 : v;
  }
  // At or below this the day reads as "beat up" and stalls stop counting. The
  // neutral score is 6 (all three answered "okay") on BOTH scales, so this is
  // genuinely below par rather than merely "not great".
  const READY_LOW_MAX = 5;
  const READINESS_MAX = READINESS_QS.reduce((n, q) => n + q.opts.length, 0);
  // Thresholds chosen so every legacy record classifies exactly as it used to
  // once remapped: old 3-7 → new 3-8 stay low/mid on the same boundaries, old
  // 8-9 → new 10-12 stay high.
  const READY_LEVELS = [
    { max: READY_LOW_MAX, id: "low",  emoji: "🪫", label: "Beat up" },
    { max: 8,             id: "mid",  emoji: "🔋", label: "Okay" },
    { max: READINESS_MAX, id: "high", emoji: "⚡", label: "Ready" },
  ];
  function readinessScore(rec) {
    if (!rec) return 0;
    return READINESS_QS.reduce((n, q) => n + readinessAnswer(rec, q.id), 0);
  }
  // null until all three are answered — a partial answer has no score to read.
  function readinessLevel(rec) {
    const s = readinessScore(rec);
    if (s < READINESS_QS.length) return null;
    return READY_LEVELS.find((l) => s <= l.max) || READY_LEVELS[READY_LEVELS.length - 1];
  }
  // Latest answer for a day, from any progress object (athlete-local or the
  // coach's mirrored importedProgress). null when unanswered.
  function dayReadiness(progress, dayId) {
    const rec = progress?.readiness?.[dayId];
    return rec && readinessLevel(rec) ? rec : null;
  }
  // The side axis, normalized: 0 when the record predates it.
  function readinessFlagAnswer(rec) {
    const v = parseInt(rec?.[READINESS_FLAG.id], 10) || 0;
    return v >= 1 && v <= READINESS_FLAG.opts.length ? v : 0;
  }

  const NS = (globalThis.STSD = globalThis.STSD || {});
  NS.training = Object.assign(NS.training || {}, {
    READINESS_QS, READINESS_FACES, READINESS_FLAG,
    READY_LOW_MAX, READINESS_MAX, READY_LEVELS,
    readinessAnswer, readinessScore, readinessLevel,
    dayReadiness, readinessFlagAnswer,
  });
})();
