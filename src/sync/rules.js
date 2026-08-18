// Extracted from app.js — Phase 1 of the module extraction. See
// docs/superpowers/specs/2026-08-17-test-runner-and-module-extraction-design.md.
//
// Loaded as a classic script (no bundler ships yet), so instead of `export`
// it assigns onto the STSD namespace; src/sync/rules.spec.js imports THIS
// file and reads the namespace, so the shipped code is the tested code.
//
// The payoff module: the sync decision rules, named. Before this file, the
// same two questions — "may this incoming row replace what's local?" and
// "what does the athlete's device keep after adopting a pulled progress
// row?" — were answered by inline if-chains copied across the realtime
// handlers, resyncNow, the boot paths and sign-in, and the copies had
// drifted: sign-in still adopted wholesale, which is the exact loss class
// the boot merge exists to close. Owner ruling 2026-08-17: sign-in merges
// when the cached data is the same account's, wholesale otherwise.
(function () {
  "use strict";

  // From src/sync/merge-logs.js and src/sync/progress-shape.js, which
  // index.html loads first (the boot smoke executes the tags in that order).
  // Checked at load so a missing or misordered tag fails HERE, by name.
  const { mergeExerciseLogs, ensureProgressShape } = globalThis.STSD.sync;
  if (typeof mergeExerciseLogs !== "function" || typeof ensureProgressShape !== "function") {
    throw new Error("src/sync/merge-logs.js and src/sync/progress-shape.js must load before rules.js");
  }

  // May an incoming row (realtime event or targeted pull) replace the local
  // copy? Two conditions, both born of real incidents:
  //  - the rev guard: an event carrying rev <= what we already hold is our
  //    own push echoing back, or stale — applying it rebuilds state
  //    mid-workout for nothing. A row with no rev at all is never news.
  //  - the dirty window: unconfirmed local edits own the surface from the
  //    moment they queue until their push confirms; without this, the echo
  //    of our own push can beat the response that teaches us the new rev
  //    and stomp whatever was typed since.
  function mayAdoptRow(o) {
    return !o.locallyDirty && (Number(o.incomingRev) || 0) > (Number(o.knownRev) || 0);
  }

  // What the athlete's device keeps after adopting a pulled progress row.
  // The cloud row wins wholesale — its other fields are preferences and
  // containers — EXCEPT exercise logs, which union so a pull can never
  // erase work the cloud has not seen yet (the pagehide flush routinely
  // dies on phones; the last-typed set is precisely the entry at risk).
  // opts.mergeLogs === false means the cached copy belongs to a DIFFERENT
  // account (shared device), whose logs must not leak into this one:
  // wholesale adopt. No cloud row → keep local, identity-returned so
  // callers can tell "unchanged"; nothing at all → null. The cloud input is
  // never mutated, and the result is always shape-repaired before anything
  // reads a field.
  function adoptedAthleteProgress(localProgress, cloudProgress, opts) {
    if (!cloudProgress) return localProgress || null;
    const mergeLogs = !opts || opts.mergeLogs !== false;
    const next = mergeLogs
      ? { ...cloudProgress, exerciseLogs: mergeExerciseLogs(localProgress?.exerciseLogs, cloudProgress.exerciseLogs) }
      : { ...cloudProgress };
    return ensureProgressShape(next);
  }

  const NS = (globalThis.STSD = globalThis.STSD || {});
  NS.sync = Object.assign(NS.sync || {}, {
    mayAdoptRow,
    adoptedAthleteProgress,
  });
})();
